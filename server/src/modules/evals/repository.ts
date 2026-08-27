import { and, count, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import type { Db, DbTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { EvalBatchRow, EvalCaseRow, EvalRunRow, FindingRow } from './helpers.js';

/**
 * L06 / SPEC-08 — eval data access. The ONLY place the eval feature's SQL
 * lives (onion §8).
 *
 * ## Tenancy is re-established here, because the schema cannot do it
 *
 * `eval_runs` has NO `workspace_id` column — it hangs off `eval_cases` and, as
 * of migration 0018, off `eval_run_batches`. So a caller who guesses a batch id
 * or a run id from another tenant is stopped by NOTHING in the database: a bare
 * `where(eq(evalRuns.batchId, id))` returns another workspace's rows and the
 * request succeeds. **AC-28 lives or dies in this file.** Every read below
 * therefore joins through a table that DOES carry `workspace_id`
 * (`eval_run_batches` or `eval_cases`) and predicates on it — never on the id
 * alone. A row from another workspace comes back `undefined` and the service
 * turns that into a 404.
 *
 * ## Aggregates come back as strings
 *
 * `count()` / `sum()` are bigint on postgres-js and arrive as STRINGS, and
 * `db.execute()` resolves to the rows themselves, never `{ rows }`
 * (`server/INSIGHTS.md:483-492`). Every aggregate below is wrapped in
 * `Number(...)`. This feature is mostly aggregates, so this is the single most
 * likely runtime defect in it.
 *
 * Write methods take an optional `tx` and resolve `tx ?? this.db`, so the
 * SERVICE owns the transaction boundary (onion §8). Never open one in here.
 */

export interface InsertEvalCase {
  workspaceId: string;
  ownerKind: 'agent' | 'skill';
  ownerId: string;
  name: string;
  inputDiff: string;
  inputMeta?: unknown;
  expectedOutput: unknown;
  notes?: string | null;
  expectation: 'must_find' | 'must_not_flag';
  sourceFindingId?: string | null;
}

export interface UpdateEvalCase {
  name?: string;
  inputDiff?: string;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
  expectation?: 'must_find' | 'must_not_flag';
}

export interface InsertEvalBatch {
  workspaceId: string;
  agentId: string;
  agentVersion: number;
  systemPromptSnapshot: string;
  provider: 'openai' | 'anthropic' | 'openrouter';
  model: string;
  casesTotal: number;
}

export interface FinishEvalBatch {
  status: 'complete' | 'partial' | 'failed';
  casesCompleted: number;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  costUsd: number | null;
  finishedAt: Date;
}

export interface InsertEvalRun {
  caseId: string;
  batchId: string;
  actualOutput: unknown;
  pass: boolean;
  status: 'passed' | 'failed' | 'errored';
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number;
  costUsd: number | null;
}

/** A finding plus the stored patch of the file it points at (AC-18, AC-19). */
export interface FindingWithPatch {
  finding: FindingRow;
  /** `null` when the PR carries no row for that path, or the row has no patch. */
  patch: string | null;
  /**
   * The agent whose review produced the finding — the owner the seeded case is
   * attached to. `null` for a summary review written by no agent, which the
   * service turns into a 422: a case with no owner would never be run by
   * anything.
   */
  agentId: string | null;
}

export class EvalRepository {
  constructor(private db: Db) {}

  // ---- findings → cases ---------------------------------------------------

  /**
   * The decided finding a case is being seeded from, together with the patch of
   * ITS OWN file and nothing else (AC-19).
   *
   * Tenancy runs through `reviews.workspace_id`: `findings` has no workspace
   * column of its own, so a bare finding id would cross tenants. Two queries
   * rather than one join because the second is keyed on a value the first
   * returns (`finding.file`), and a three-way join with an inequality-free
   * `pr_files` match reads worse than the sequence.
   */
  async findingWithPatch(workspaceId: string, findingId: string): Promise<FindingWithPatch | undefined> {
    const [row] = await this.db
      .select({ finding: t.findings, prId: t.reviews.prId, agentId: t.reviews.agentId })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .where(and(eq(t.reviews.workspaceId, workspaceId), eq(t.findings.id, findingId)));
    if (!row) return undefined;

    const [file] = await this.db
      .select({ patch: t.prFiles.patch })
      .from(t.prFiles)
      .where(and(eq(t.prFiles.prId, row.prId), eq(t.prFiles.path, row.finding.file)));

    return { finding: row.finding, patch: file?.patch ?? null, agentId: row.agentId };
  }

  /** Cases already created from one finding (AC-25), workspace-scoped. */
  casesForFinding(workspaceId: string, findingId: string): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.sourceFindingId, findingId)),
      );
  }

  // ---- cases --------------------------------------------------------------

  async insertCase(values: InsertEvalCase, tx?: DbTx): Promise<EvalCaseRow> {
    const invoker = tx ?? this.db;
    const [row] = await invoker
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff,
        inputMeta: values.inputMeta ?? null,
        expectedOutput: values.expectedOutput,
        notes: values.notes ?? null,
        expectation: values.expectation,
        sourceFindingId: values.sourceFindingId ?? null,
      })
      .returning();
    return row!;
  }

  /**
   * An owner's whole case set in ONE response, unpaginated (NFR-14). Ordered by
   * name so the Evals tab is stable across reloads.
   */
  listCases(workspaceId: string, ownerKind: 'agent' | 'skill', ownerId: string): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      )
      .orderBy(t.evalCases.name);
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row;
  }

  async updateCase(
    workspaceId: string,
    id: string,
    values: UpdateEvalCase,
    tx?: DbTx,
  ): Promise<EvalCaseRow | undefined> {
    const invoker = tx ?? this.db;
    const [row] = await invoker
      .update(t.evalCases)
      .set(values)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row;
  }

  async deleteCase(workspaceId: string, id: string, tx?: DbTx): Promise<boolean> {
    const invoker = tx ?? this.db;
    const deleted = await invoker
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return deleted.length > 0;
  }

  /** How many cases an owner has. `count()` is a STRING on postgres-js. */
  async countCases(
    workspaceId: string,
    ownerKind: 'agent' | 'skill',
    ownerId: string,
  ): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
    return Number(row?.n ?? 0);
  }

  // ---- batches ------------------------------------------------------------

  /**
   * The agent's batch that is still running, if any — the 409 check. Scoped by
   * workspace even though `agent_id` alone would find it: an agent id from
   * another tenant must not be able to observe that tenant's batch state.
   */
  async runningBatch(workspaceId: string, agentId: string): Promise<EvalBatchRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalRunBatches)
      .where(
        and(
          eq(t.evalRunBatches.workspaceId, workspaceId),
          eq(t.evalRunBatches.agentId, agentId),
          eq(t.evalRunBatches.status, 'running'),
        ),
      )
      .orderBy(desc(t.evalRunBatches.startedAt))
      .limit(1);
    return row;
  }

  async insertBatch(values: InsertEvalBatch, tx?: DbTx): Promise<EvalBatchRow> {
    const invoker = tx ?? this.db;
    const [row] = await invoker
      .insert(t.evalRunBatches)
      .values({ ...values, status: 'running', casesCompleted: 0 })
      .returning();
    return row!;
  }

  async finishBatch(id: string, values: FinishEvalBatch, tx?: DbTx): Promise<EvalBatchRow | undefined> {
    const invoker = tx ?? this.db;
    const [row] = await invoker
      .update(t.evalRunBatches)
      .set(values)
      .where(eq(t.evalRunBatches.id, id))
      .returning();
    return row;
  }

  /** Bump the progress counter as each case lands, so a reader can watch it move. */
  async bumpBatchProgress(id: string, casesCompleted: number, tx?: DbTx): Promise<void> {
    const invoker = tx ?? this.db;
    await invoker
      .update(t.evalRunBatches)
      .set({ casesCompleted })
      .where(eq(t.evalRunBatches.id, id));
  }

  async getBatch(workspaceId: string, id: string): Promise<EvalBatchRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalRunBatches)
      .where(and(eq(t.evalRunBatches.workspaceId, workspaceId), eq(t.evalRunBatches.id, id)));
    return row;
  }

  /**
   * An agent's FINISHED batches, newest first. "Finished" excludes `running`
   * deliberately: a batch in flight has no aggregates yet, so putting it in the
   * trend or reading it as `current` would show a real batch as three dashes.
   *
   * This is also the delta's baseline, and deliberately the ONLY route to it:
   * `[0]` is the current batch and `[1]` is the previous one, so AC-56's
   * comparison is a subscript on a list the dashboard already holds. A dedicated
   * `previousBatch(workspaceId, agentId, startedAt)` existed here and was
   * DELETED — it issued a second round trip for a row already in hand, it had no
   * caller, and an uncalled repository method reads as covered because the code
   * beside it is. Do not re-add it without a caller.
   */
  finishedBatches(workspaceId: string, agentId: string, limit: number): Promise<EvalBatchRow[]> {
    return this.db
      .select()
      .from(t.evalRunBatches)
      .where(
        and(
          eq(t.evalRunBatches.workspaceId, workspaceId),
          eq(t.evalRunBatches.agentId, agentId),
          ne(t.evalRunBatches.status, 'running'),
          isNotNull(t.evalRunBatches.finishedAt),
        ),
      )
      .orderBy(desc(t.evalRunBatches.startedAt))
      .limit(limit);
  }

  /**
   * An agent's batch history — EVERY batch, any status, newest first.
   *
   * A SIBLING of `finishedBatches`, not a widening of it, and the distinction is
   * load-bearing. `finishedBatches` excludes `running` because its two consumers
   * (`trend` and the `current`/`delta` pair) would otherwise show a real batch as
   * three dashes the moment a new run starts. This read has the opposite need: a
   * running batch is legitimately part of the history, and the client renders its
   * lifecycle from `status`. Widening the existing method to serve both would
   * have reintroduced exactly the defect its doc block warns about, under a name
   * that promises the opposite.
   *
   * ORDERING IS PART OF THE CONTRACT, not an incidental. The client pairs the two
   * selected rows as `(older, newer)` by `started_at` and the compare endpoint
   * reports `b − a`, so a reversed list silently inverts every delta sign and an
   * improvement reads as a regression — worse than an error, because nothing
   * looks wrong. Newest first, with `id` as a deterministic tiebreaker: two
   * batches can share a `started_at` (the column defaults to `now()`, which is
   * transaction time), and Postgres gives no ordering guarantee for ties, so
   * without the second key the same query could return two different orders.
   *
   * Capped at the caller's `limit` (`BATCH_HISTORY_LIMIT`) — one unpaginated
   * response, but never an unbounded one.
   */
  listBatches(workspaceId: string, agentId: string, limit: number): Promise<EvalBatchRow[]> {
    return this.db
      .select()
      .from(t.evalRunBatches)
      .where(
        and(
          // The same tenancy predicate as every other read in this file. This is
          // the fifth workspace-scoped batch read; AC-28 covers the other four.
          eq(t.evalRunBatches.workspaceId, workspaceId),
          eq(t.evalRunBatches.agentId, agentId),
        ),
      )
      .orderBy(desc(t.evalRunBatches.startedAt), desc(t.evalRunBatches.id))
      .limit(limit);
  }

  /**
   * The agent's newest batch of ANY status, including one still running.
   *
   * Deliberately not `finishedBatches[0]`: that one excludes `running` on
   * purpose, and this read exists precisely to see the row it excludes. It is
   * the dashboard's running-state channel — a client that did not itself start
   * the batch has no other way to know one is in flight.
   */
  async latestBatch(workspaceId: string, agentId: string): Promise<EvalBatchRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalRunBatches)
      .where(
        and(
          eq(t.evalRunBatches.workspaceId, workspaceId),
          eq(t.evalRunBatches.agentId, agentId),
        ),
      )
      .orderBy(desc(t.evalRunBatches.startedAt))
      .limit(1);
    return row;
  }

  // ---- runs ---------------------------------------------------------------

  async insertRun(values: InsertEvalRun, tx?: DbTx): Promise<EvalRunRow> {
    const invoker = tx ?? this.db;
    const [row] = await invoker.insert(t.evalRuns).values(values).returning();
    return row!;
  }

  /**
   * The runs of one batch, with their case names.
   *
   * The join to `eval_run_batches` is NOT decoration — it is the tenancy guard.
   * `eval_runs` carries no `workspace_id`, so without this predicate a batch id
   * from another workspace returns that workspace's runs.
   */
  runsForBatch(
    workspaceId: string,
    batchId: string,
  ): Promise<{ run: EvalRunRow; caseName: string | null }[]> {
    return this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name })
      .from(t.evalRuns)
      .innerJoin(t.evalRunBatches, eq(t.evalRuns.batchId, t.evalRunBatches.id))
      .leftJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(
        and(eq(t.evalRunBatches.workspaceId, workspaceId), eq(t.evalRuns.batchId, batchId)),
      )
      .orderBy(t.evalRuns.ranAt);
  }

  /** An agent's most recent run rows across all its batches, newest first. */
  recentRuns(
    workspaceId: string,
    agentId: string,
    limit: number,
  ): Promise<{ run: EvalRunRow; caseName: string | null }[]> {
    return this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name })
      .from(t.evalRuns)
      .innerJoin(t.evalRunBatches, eq(t.evalRuns.batchId, t.evalRunBatches.id))
      .leftJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(
        and(
          eq(t.evalRunBatches.workspaceId, workspaceId),
          eq(t.evalRunBatches.agentId, agentId),
        ),
      )
      .orderBy(desc(t.evalRuns.ranAt))
      .limit(limit);
  }

  /**
   * How many runs PASSED, per batch — the trend's `pass_rate` numerator and the
   * dashboard's "traces passed" tile.
   *
   * Aggregation is a query, not a loop over rows in the service (onion §8), and
   * `count()` arrives as a string, hence the `Number()`. An empty `batchIds`
   * short-circuits: `inArray(x, [])` is a SQL error on some drivers and an
   * always-false predicate on others, and neither is worth a round trip.
   */
  async passedCountByBatch(workspaceId: string, batchIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (batchIds.length === 0) return out;
    const rows = await this.db
      .select({ batchId: t.evalRuns.batchId, n: count() })
      .from(t.evalRuns)
      .innerJoin(t.evalRunBatches, eq(t.evalRuns.batchId, t.evalRunBatches.id))
      .where(
        and(
          eq(t.evalRunBatches.workspaceId, workspaceId),
          inArray(t.evalRuns.batchId, batchIds),
          eq(t.evalRuns.status, 'passed'),
        ),
      )
      .groupBy(t.evalRuns.batchId);
    for (const row of rows) {
      if (row.batchId) out.set(row.batchId, Number(row.n));
    }
    return out;
  }
}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import type {
  CompletionRequest,
  CompletionResult,
  LLMProvider,
  ModelInfo,
  Review,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { EvalBatchRecord } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { EvalService } from '../src/modules/evals/service.js';
import { EvalInvariantError } from '../src/modules/evals/helpers.js';
import { EVAL_TRACE_ROLE } from '../src/modules/evals/constants.js';
import type { PinoLike } from '../src/platform/run-logger.js';
import * as t from '../src/db/schema.js';
import {
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockSecretsProvider,
  MockSourceReader,
} from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals-batch] Docker not available — skipping integration tests.');
}

/**
 * L06 / SPEC-08 — running an agent's whole case set (AC-29, AC-36…AC-42,
 * AC-48…AC-54, AC-111, AC-112, AC-115, NFR-5, NFR-7).
 *
 * ## Why `runBatch` and not `app.inject` + polling
 *
 * There are two entry points on purpose. `startBatch` detaches — eight cases at
 * a 120 s ceiling could hold an HTTP request for sixteen minutes — while
 * `runBatch` awaits and returns the finished row. AC-29 ("the eval path writes
 * nothing to the review tables") and NFR-5 ("exactly one provider call per
 * case") are not assertable against a fire-and-forget promise: a poll that saw
 * the counters unchanged might simply have looked before the write. Both entry
 * points funnel through the same private `execute`, so testing the awaited path
 * tests both. The two route-level refusals that happen BEFORE the detach (409,
 * 422) are exercised through `app.inject`, where they belong.
 *
 * ## Two deviations from the original plan are pinned here deliberately
 *
 * 1. **A case that RAN and failed stays in the batch denominators.** Only
 *    `errored` cases are excluded. If the failures were dropped too, `recall`
 *    would be identically 1.0 on every batch and the whole harness would
 *    measure nothing — so the mixed fixture below must produce a recall BELOW 1.
 * 2. **`partial` means "at least one case errored"**, not "at least one did not
 *    pass". A batch where every case ran and some scored badly is `complete`.
 *
 * Every adapter is overridden; see the note in `evals-create.it.test.ts` for why
 * the empty `MockSecretsProvider` is the load-bearing one.
 *
 * FILE NAME IS LOAD-BEARING: `*.it.test.ts` is how the CI suite split finds the
 * Docker-requiring tests.
 */

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const ALPHA_DIFF = [
  'diff --git a/src/alpha.ts b/src/alpha.ts',
  '--- a/src/alpha.ts',
  '+++ b/src/alpha.ts',
  '@@ -0,0 +1,3 @@',
  '+const a = 1;',
  '+const stripeKey = "sk_live_xxx";',
  '+const c = 3;',
].join('\n');

const BETA_DIFF = [
  'diff --git a/src/beta.ts b/src/beta.ts',
  '--- a/src/beta.ts',
  '+++ b/src/beta.ts',
  '@@ -0,0 +1,3 @@',
  '+const x = 1;',
  '+const y = 2;',
  '+const z = 3;',
].join('\n');

/**
 * The model always answers with the SAME finding, on `src/alpha.ts` line 2.
 *
 * That single fixture is what produces a mixed batch without any per-case
 * cleverness: against the alpha case it is a hit, against a beta case grounding
 * drops it (its file is not in that case's diff) and the case scores zero.
 */
const ALPHA_FINDING: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/alpha.ts',
      start_line: 2,
      end_line: 2,
      rationale: 'A live Stripe key is committed in source.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

/**
 * A provider whose per-call behaviour the test controls: what it answers, what
 * it costs, whether it throws, and — through `events` — WHEN it entered and
 * left each call.
 *
 * `MockLLMProvider` is used for the plain batch below, because it is the shipped
 * fake and it validates its fixture against the caller's schema. This exists
 * only for the three states that fake cannot express: an unknown cost, a thrown
 * `EvalInvariantError`, and an observable call window.
 */
class ScriptedLLM implements LLMProvider {
  readonly id = 'openai' as const;
  /** `enter:N` / `exit:N` per call, in the order they happened (AC-37). */
  public events: string[] = [];
  public calls = 0;

  constructor(
    private opts: {
      review?: Review;
      costUsd?: number | null;
      throwOn?: (n: number) => Error | undefined;
      delayMs?: number;
    } = {},
  ) {}

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'gpt-4.1', provider: 'openai' }];
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return { text: '', model: req.model, tokensIn: 0, tokensOut: 0, costUsd: 0 };
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const n = ++this.calls;
    this.events.push(`enter:${n}`);
    try {
      const err = this.opts.throwOn?.(n);
      if (err) throw err;
      if (this.opts.delayMs) await new Promise((r) => setTimeout(r, this.opts.delayMs));
      // Same discipline as `MockLLMProvider`: the canned answer is parsed
      // against the CALLER's schema, so a contract change breaks the fixture
      // loudly instead of letting a stale shape flow into the test.
      const parsed = req.schema.safeParse(this.opts.review ?? ALPHA_FINDING);
      if (!parsed.success) throw new Error(`ScriptedLLM fixture failed schema: ${parsed.error.message}`);
      return {
        data: parsed.data,
        model: req.model,
        tokensIn: 100,
        tokensOut: 50,
        costUsd: this.opts.costUsd === undefined ? 0.001 : this.opts.costUsd,
        raw: '{}',
        attempts: 1,
      };
    } finally {
      this.events.push(`exit:${n}`);
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => []);
  }
}

/** Captures what the run logger mirrored to stdout (NFR-7). */
function capturingLogger(): PinoLike & { lines: string[] } {
  const lines: string[] = [];
  const record = (_obj: unknown, msg?: string) => {
    if (msg) lines.push(msg);
  };
  return { lines, info: record, warn: record, error: record, debug: record };
}

d('EvalService.runBatch', () => {
  let pg: PgFixture;
  let db: PgFixture['handle']['db'];
  let workspaceId: string;

  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

  /** A fresh app whose only interesting override is the provider under test. */
  async function appWith(llm: LLMProvider) {
    const app = await buildApp({
      config: config(),
      db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        sourceReader: new MockSourceReader({}),
        llm: { openrouter: llm },
      },
    });
    await app.ready();
    apps.push(app);
    return app;
  }

  let agentSeq = 0;
  async function makeAgent(systemPrompt = 'You are a reviewer.') {
    const [agent] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        name: `Eval Agent ${agentSeq++}`,
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        systemPrompt,
        version: 4,
      })
      .returning();
    return agent!;
  }

  async function addCase(
    agentId: string,
    name: string,
    expectation: 'must_find' | 'must_not_flag',
    inputDiff: string,
    expectedOutput: unknown,
  ) {
    await db.insert(t.evalCases).values({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name,
      inputDiff,
      expectedOutput,
      expectation,
    });
  }

  /** The mixed set: one hit, one miss, one clean negative. */
  async function mixedSet(agentId: string) {
    await addCase(agentId, 'a-alpha-hit', 'must_find', ALPHA_DIFF, [
      { file: 'src/alpha.ts', start_line: 2, end_line: 2, kind: 'finding' },
    ]);
    await addCase(agentId, 'b-beta-miss', 'must_find', BETA_DIFF, [
      { file: 'src/beta.ts', start_line: 2, end_line: 2, kind: 'finding' },
    ]);
    await addCase(agentId, 'c-beta-clean', 'must_not_flag', BETA_DIFF, []);
  }

  const countRows = async () => {
    const [row] = await pg.handle.sql<{ reviews: number; findings: number; runs: number }[]>`
      SELECT (SELECT count(*) FROM reviews)::int    AS reviews,
             (SELECT count(*) FROM findings)::int   AS findings,
             (SELECT count(*) FROM agent_runs)::int AS runs`;
    return row!;
  };

  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;
    const seeded = await seed(db);
    workspaceId = seeded.workspaceId;

    // A run row that exists BEFORE any batch, so the "unchanged" assertion
    // compares 1 against 1 rather than 0 against 0 — `pnpm db:seed` writes no
    // `agent_runs` row (`server/INSIGHTS.md`, 2026-07-28).
    const [pr] = await db.select().from(t.pullRequests).limit(1);
    await db
      .insert(t.agentRuns)
      .values({ workspaceId, prId: pr!.id, status: 'done', provider: 'openrouter' });
  }, 180_000);

  afterAll(async () => {
    for (const app of apps) await app.close();
    await pg?.stop();
  });

  it('runs every case once, scores the batch, and leaves the review tables untouched', async () => {
    const llm = new MockLLMProvider('openai', { structured: ALPHA_FINDING });
    const app = await appWith(llm);
    const service = new EvalService(app.container);
    const agent = await makeAgent();
    await mixedSet(agent.id);

    const before = await countRows();
    expect(before.reviews).toBeGreaterThan(0);
    expect(before.findings).toBeGreaterThan(0);
    expect(before.runs).toBeGreaterThan(0);

    const batch = EvalBatchRecord.parse(await service.runBatch(workspaceId, agent.id));

    // ---- AC-29: an eval run is not a review run -------------------------
    // Not "few" rows and not "no new findings for this PR" — UNCHANGED counts.
    // These three tables are the entire footprint of the review path, and
    // bypassing it is what makes AC-44 and AC-102…AC-106 achievable at all.
    expect(await countRows()).toEqual(before);

    // ---- AC-36 + NFR-5: one case, one call ------------------------------
    const structured = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structured).toHaveLength(3);
    expect(batch.cases_total).toBe(3);
    expect(batch.cases_completed).toBe(3);

    const runs = await db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.batchId, batch.id))
      .orderBy(asc(t.evalRuns.ranAt));
    expect(runs).toHaveLength(3);

    // ---- the mixed outcome ----------------------------------------------
    const byStatus = runs.map((r) => r.status).sort();
    expect(byStatus).toEqual(['failed', 'passed', 'passed']);

    // ---- deviation 1: a FAILED case stays in the denominators -----------
    // recall = 1 matched / 2 expected. If failing cases were excluded the way
    // the plan first said, this would be 1.0 — and it would be 1.0 on every
    // batch forever, which is the one number that would make the harness
    // useless while looking perfect.
    expect(batch.recall).toBeCloseTo(0.5, 10);
    expect(batch.recall).not.toBe(1);
    // precision = 1 matched / 1 surviving finding; the beta cases contributed
    // no survivors, because grounding dropped the model's alpha finding.
    expect(batch.precision).toBeCloseTo(1, 10);
    // citation = 1 kept / 3 (kept + dropped) across the completed cases (AC-54).
    expect(batch.citation_accuracy).toBeCloseTo(1 / 3, 10);

    // ---- deviation 2: `partial` means ERRORED, not "not passed" ----------
    expect(batch.status).toBe('complete');
    expect(batch.partial).toBe(false);

    // ---- AC-51: the cost is the sum over completed cases -----------------
    expect(batch.cost_usd).toBeCloseTo(0.003, 10);
  });

  it('snapshots the prompt, version, provider and model at START (AC-48, AC-49, AC-50)', async () => {
    const app = await appWith(new MockLLMProvider('openai', { structured: ALPHA_FINDING }));
    const service = new EvalService(app.container);
    const agent = await makeAgent('PROMPT VERSION ONE');
    await mixedSet(agent.id);

    const batch = await service.runBatch(workspaceId, agent.id);

    expect(batch.system_prompt_snapshot).toBe('PROMPT VERSION ONE');
    expect(batch.agent_version).toBe(4);
    expect(batch.provider).toBe('openrouter');
    expect(batch.model).toBe('deepseek/deepseek-v4-flash');

    // Editing the agent afterwards does not rewrite what this batch ran
    // against — which is the entire basis on which two batches are comparable.
    await db
      .update(t.agents)
      .set({ systemPrompt: 'PROMPT VERSION TWO', version: 5 })
      .where(eq(t.agents.id, agent.id));

    const reread = await service.getBatch(workspaceId, batch.id);
    expect(reread.system_prompt_snapshot).toBe('PROMPT VERSION ONE');
    expect(reread.agent_version).toBe(4);
  });

  it('runs the cases ONE AT A TIME and labels each call by role (AC-37, NFR-7)', async () => {
    const llm = new ScriptedLLM({ delayMs: 15 });
    const app = await appWith(llm);
    const service = new EvalService(app.container);
    const agent = await makeAgent();
    await mixedSet(agent.id);

    const logger = capturingLogger();
    await service.runBatch(workspaceId, agent.id, logger);

    // The recorded call windows never overlap. `Promise.all` over three cases
    // would interleave to enter:1,enter:2,… and would also make the per-case
    // 120 s ceiling meaningless.
    expect(llm.events).toEqual(['enter:1', 'exit:1', 'enter:2', 'exit:2', 'enter:3', 'exit:3']);

    // NFR-7 — one trace line per case, labelled by ROLE. An eval run and a PR
    // review of the same agent use the SAME model, so the slug alone cannot
    // tell a reader which one spent the money.
    const traceLines = logger.lines.filter((l) => l.startsWith(EVAL_TRACE_ROLE));
    expect(traceLines).toHaveLength(3);
    expect(traceLines[0]).toContain('openrouter/deepseek/deepseek-v4-flash');
    expect(traceLines[0]).toContain('a-alpha-hit');
  });

  it('records an unparseable diff as ERRORED, keeps going, and marks the batch partial', async () => {
    const app = await appWith(new MockLLMProvider('openai', { structured: ALPHA_FINDING }));
    const service = new EvalService(app.container);
    const agent = await makeAgent();
    // Named so `listCases`' ORDER BY name puts the broken one FIRST: AC-39 is
    // about the batch continuing past a failure, which a trailing bad case
    // could never demonstrate.
    await addCase(agent.id, 'a-broken', 'must_find', 'this is not a diff at all', [
      { file: 'src/alpha.ts', start_line: 2, end_line: 2 },
    ]);
    await addCase(agent.id, 'b-alpha-hit', 'must_find', ALPHA_DIFF, [
      { file: 'src/alpha.ts', start_line: 2, end_line: 2, kind: 'finding' },
    ]);

    const batch = EvalBatchRecord.parse(await service.runBatch(workspaceId, agent.id));

    const runs = await db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.batchId, batch.id))
      .orderBy(asc(t.evalRuns.ranAt));

    // AC-40 — `errored` by name, and distinct from `failed` by name. `pass:
    // false` is true of both, so `pass` cannot carry this distinction.
    expect(runs.map((r) => r.status)).toEqual(['errored', 'passed']);
    expect(runs[0]!.status).not.toBe('failed');

    // AC-38 — the row exists, does not pass, and its metrics are EMPTY rather
    // than zero. A zero here would enter the average as a real bad score.
    expect(runs[0]!.pass).toBe(false);
    expect(runs[0]!.recall).toBeNull();
    expect(runs[0]!.precision).toBeNull();
    expect(runs[0]!.citationAccuracy).toBeNull();

    // AC-39 — the batch carried on to the next case.
    expect(runs[1]!.pass).toBe(true);

    // AC-41 + AC-42 — partial, and the aggregates cover the ONE completed case.
    expect(batch.status).toBe('partial');
    expect(batch.partial).toBe(true);
    expect(batch.cases_total).toBe(2);
    expect(batch.cases_completed).toBe(1);
    expect(batch.recall).toBeCloseTo(1, 10);
  });

  it('marks the batch cost UNKNOWN, not zero, when a completed case’s cost is unknown (AC-52)', async () => {
    const app = await appWith(new ScriptedLLM({ costUsd: null }));
    const service = new EvalService(app.container);
    const agent = await makeAgent();
    await mixedSet(agent.id);

    const batch = await service.runBatch(workspaceId, agent.id);

    expect(batch.cost_usd).toBeNull();
    // Named by hand: `0` type-checks, renders, and reads as "this batch was
    // free" beside three billed calls. That is a wrong spend figure with
    // nothing on screen to say it is wrong.
    expect(batch.cost_usd).not.toBe(0);
  });

  it('lets an INVARIANT violation escape instead of degrading into one more grey row (AC-46)', async () => {
    // The second half of AC-46. The first — that arming `scopeFilter` throws —
    // is `evals-inputs.test.ts`. This is the half that would rot silently: the
    // runner turns any thrown case into an `errored` row and carries on, which
    // would swallow a broken invariant as easily as a flaky provider, and the
    // batch would come back `partial` with a plausible-looking number on it.
    const app = await appWith(
      new ScriptedLLM({ throwOn: (n) => (n === 1 ? new EvalInvariantError('scopeFilter armed') : undefined) }),
    );
    const service = new EvalService(app.container);
    const agent = await makeAgent();
    await mixedSet(agent.id);

    await expect(service.runBatch(workspaceId, agent.id)).rejects.toThrow(EvalInvariantError);

    const [batch] = await db
      .select()
      .from(t.evalRunBatches)
      .where(eq(t.evalRunBatches.agentId, agent.id));

    // It did not finish as `partial` with two cases quietly recorded.
    expect(batch!.status).toBe('running');
    const runs = await db.select().from(t.evalRuns).where(eq(t.evalRuns.batchId, batch!.id));
    expect(runs).toEqual([]);
  });

  it('treats an ORDINARY provider error as an errored case, not as an escape', async () => {
    // The control for the test above: same throw site, different class,
    // different outcome. Without this pair, "the invariant escapes" is
    // indistinguishable from "any error escapes", and AC-39 would be broken.
    const app = await appWith(new ScriptedLLM({ throwOn: () => new Error('provider exploded') }));
    const service = new EvalService(app.container);
    const agent = await makeAgent();
    await mixedSet(agent.id);

    const batch = await service.runBatch(workspaceId, agent.id);

    expect(batch.status).toBe('partial');
    expect(batch.cases_completed).toBe(0);
    const runs = await db.select().from(t.evalRuns).where(eq(t.evalRuns.batchId, batch.id));
    expect(runs.map((r) => r.status)).toEqual(['errored', 'errored', 'errored']);
    // Nothing to average over → unknown, and specifically not 0 and not 1.
    expect(batch.recall).toBeNull();
    expect(batch.precision).toBeNull();
  });

  it('stores a SECOND run of the same set as its own batch row (AC-115, AC-60)', async () => {
    // The model's answer is keyed on a marker in the system prompt, which is
    // what makes "the prompt moved the metrics" demonstrable at all: the second
    // batch's aggregates have to come from the second run's finding set, not
    // from a cached first one.
    const llm = new ScriptedLLM();
    const app = await appWith(llm);
    const service = new EvalService(app.container);
    const agent = await makeAgent('BASELINE PROMPT');
    await mixedSet(agent.id);

    const first = await service.runBatch(workspaceId, agent.id);

    // Ablate the instruction the alpha case depends on: the model now answers
    // with nothing at all.
    await db
      .update(t.agents)
      .set({ systemPrompt: 'ABLATED PROMPT' })
      .where(eq(t.agents.id, agent.id));
    const silent = new ScriptedLLM({
      review: { verdict: 'comment', summary: 'nothing found', score: 100, findings: [] },
    });
    const app2 = await appWith(silent);
    const second = await new EvalService(app2.container).runBatch(workspaceId, agent.id);

    expect(second.id).not.toBe(first.id);
    expect(second.system_prompt_snapshot).toBe('ABLATED PROMPT');
    expect(first.system_prompt_snapshot).toBe('BASELINE PROMPT');

    // The second batch's numbers are the second run's: the alpha case no longer
    // hits, so recall collapses from 0.5 to 0.
    expect(first.recall).toBeCloseTo(0.5, 10);
    expect(second.recall).toBe(0);
    expect(second.recall).not.toBeNull();

    const batches = await db
      .select()
      .from(t.evalRunBatches)
      .where(eq(t.evalRunBatches.agentId, agent.id));
    expect(batches).toHaveLength(2);
  });
});

d('POST /agents/:id/eval-batches — the refusals that happen before the detach', () => {
  let pg: PgFixture;
  let db: PgFixture['handle']['db'];
  let app: Awaited<ReturnType<typeof buildApp>>;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;
    const seeded = await seed(db);
    workspaceId = seeded.workspaceId;
    app = await buildApp({
      config: config(),
      db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        sourceReader: new MockSourceReader({}),
        llm: { openrouter: new MockLLMProvider('openai', { structured: ALPHA_FINDING }) },
      },
    });
    await app.ready();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  async function agentWithNoCases() {
    const [agent] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        name: `Empty Agent ${Math.random()}`,
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        systemPrompt: 'You are a reviewer.',
      })
      .returning();
    return agent!;
  }

  it('refuses a run over an EMPTY case set with 422 (AC-112)', async () => {
    const agent = await agentWithNoCases();

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-batches` });

    expect(res.statusCode).toBe(422);
    // And no batch row was created — a batch over nothing would finish
    // instantly with three unknowns and read as a real, unmeasurable run.
    const batches = await db
      .select()
      .from(t.evalRunBatches)
      .where(eq(t.evalRunBatches.agentId, agent.id));
    expect(batches).toEqual([]);
  });

  it('refuses a SECOND batch while one is running, with 409 (AC-111)', async () => {
    const agent = await agentWithNoCases();
    await db.insert(t.evalCases).values({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agent.id,
      name: 'a-case',
      inputDiff: ALPHA_DIFF,
      expectedOutput: [],
      expectation: 'must_not_flag',
    });
    const [running] = await db
      .insert(t.evalRunBatches)
      .values({
        workspaceId,
        agentId: agent.id,
        agentVersion: 1,
        systemPromptSnapshot: 'You are a reviewer.',
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        status: 'running',
        casesTotal: 1,
      })
      .returning();

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-batches` });

    // There is no queue, so the honest answer is a refusal that names the batch
    // already in flight — two snapshots for one agent version and no way to say
    // which run belonged to which click is the alternative.
    expect(res.statusCode).toBe(409);
    expect(JSON.stringify(res.json())).toContain(running!.id);
  });

  it('404s a batch id that does not exist', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/eval-batches/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(404);
  });
});

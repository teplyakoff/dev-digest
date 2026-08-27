import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { pullRequests } from './pulls';
import { agents } from './agents';
import { findings } from './reviews';

// ============================================================ Eval / Conformance / Compose

export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    inputDiff: text('input_diff'),
    inputFiles: jsonb('input_files'),
    inputMeta: jsonb('input_meta'),
    expectedOutput: jsonb('expected_output'),
    notes: text('notes'),
    /**
     * The decided finding this case was created from. `ON DELETE SET NULL`, not
     * cascade: deleting a finding must not delete the regression case it
     * produced — the case carries its own diff and expectation and stays
     * runnable, it just loses the pointer back to its origin.
     */
    sourceFindingId: uuid('source_finding_id').references(() => findings.id, {
      onDelete: 'set null',
    }),
    /**
     * What the case asserts. Values mirror `EvalExpectation` in
     * vendor/shared/contracts/eval-ci.ts EXACTLY — if that enum gains a member,
     * the CHECK below is the second edit, and a mismatch shows up as an insert
     * that fails at runtime, so change them together. Same convention as
     * `findings_severity_ck` in reviews.ts, and NOT NULL because a CHECK alone
     * lets NULL through (three-valued logic).
     */
    expectation: text('expectation', { enum: ['must_find', 'must_not_flag'] }).notNull(),
  },
  (t) => ({
    // "The cases of this agent", the Evals tab's only read, and it is always
    // tenant-scoped — the column order matches that predicate.
    ownerIdx: index('eval_cases_owner_idx').on(t.workspaceId, t.ownerKind, t.ownerId),
    // An FK's referencing column needs its own index: without it, deleting a
    // finding scans this table to apply SET NULL.
    sourceFindingIdx: index('eval_cases_source_finding_idx').on(t.sourceFindingId),
    expectationCk: check(
      'eval_cases_expectation_ck',
      sql`${t.expectation} in ('must_find','must_not_flag')`,
    ),
  }),
);

/**
 * One execution of an agent's WHOLE case set, against a snapshot of the exact
 * prompt, version, provider and model that produced it. The snapshot is what
 * makes "old prompt vs new" a comparison rather than an anecdote: the agent can
 * be edited a minute later without retroactively changing what this batch ran.
 */
export const evalRunBatches = pgTable(
  'eval_run_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    agentVersion: integer('agent_version').notNull(),
    systemPromptSnapshot: text('system_prompt_snapshot'),
    provider: text('provider', { enum: ['openai', 'anthropic', 'openrouter'] }).notNull(),
    model: text('model').notNull(),
    /**
     * Values mirror `EvalBatchStatus` in vendor/shared/contracts/eval-ci.ts
     * EXACTLY — one edit in two places. `partial` = finished with at least one
     * case not passing cleanly; `failed` = the batch itself could not run.
     */
    status: text('status', { enum: ['running', 'complete', 'partial', 'failed'] }).notNull(),
    casesTotal: integer('cases_total').notNull().default(0),
    casesCompleted: integer('cases_completed').notNull().default(0),
    // Nullable on purpose: a zero denominator is "unknown", never 0 and never 1.
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    // Null — not 0 — when any completed case's cost is unknown.
    costUsd: doublePrecision('cost_usd'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => ({
    // Both hot reads are per-agent and newest-first: "is a batch already
    // running for this agent" (the 409) and "the previous batch" (the delta).
    agentIdx: index('eval_run_batches_agent_started_idx').on(t.agentId, t.startedAt.desc()),
    statusCk: check(
      'eval_run_batches_status_ck',
      sql`${t.status} in ('running','complete','partial','failed')`,
    ),
  }),
);

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => evalCases.id, { onDelete: 'cascade' }),
    /**
     * The batch this run belongs to. Nullable: a run may exist outside a batch
     * (a single case run on its own), and the pre-0018 rows have no batch.
     */
    batchId: uuid('batch_id').references(() => evalRunBatches.id, { onDelete: 'cascade' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    actualOutput: jsonb('actual_output'),
    pass: boolean('pass'),
    /**
     * `errored` is deliberately distinct from `failed` — the case never produced
     * a comparable answer, which is not the same as producing a wrong one.
     * `pass` cannot carry that third state: its own NULL already means "metrics
     * empty". Values mirror `EvalRunStatus` in
     * vendor/shared/contracts/eval-ci.ts EXACTLY — one edit in two places.
     * Nullable (so the CHECK admits NULL) because the rows written before this
     * column existed have no status to backfill.
     */
    status: text('status', { enum: ['passed', 'failed', 'errored'] }),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
  },
  (t) => ({
    // Every batch read is "the runs of this batch"; and the FK needs its own
    // index so a batch delete does not scan the table.
    batchIdx: index('eval_runs_batch_idx').on(t.batchId),
    statusCk: check('eval_runs_status_ck', sql`${t.status} in ('passed','failed','errored')`),
  }),
);

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});

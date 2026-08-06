import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Review & findings

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id'),
    /** The agent_run that produced this review (links the timeline run ↔ review). */
    runId: uuid('run_id'),
    kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
    verdict: text('verdict'),
    summary: text('summary'),
    score: integer('score'),
    model: text('model'),
    createdAt: now(),
  },
  (t) => ({
    // The PR list's "latest review per PR" read: `WHERE pr_id IN (…) AND
    // kind = 'review' ORDER BY created_at DESC`. Column order matches that
    // predicate, and created_at is DESC so the sort is read straight off the
    // index instead of being re-sorted.
    latestIdx: index('reviews_pr_kind_created_idx').on(t.prId, t.kind, t.createdAt.desc()),
  }),
);

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    file: text('file').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    severity: text('severity').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    rationale: text('rationale').notNull(),
    suggestion: text('suggestion'),
    confidence: doublePrecision('confidence').notNull(),
    kind: text('kind').notNull().default('finding'),
    trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (t) => ({
    // Every findings read is "the findings of these reviews" — the PR list's
    // severity counters, the detail page, the run trace. Without this it is a
    // sequential scan of the whole table per request.
    reviewIdx: index('findings_review_idx').on(t.reviewId),

    // `severity` and `category` are written only through the Finding contract,
    // and `modules/pulls` casts them straight back to the contract's enum with a
    // comment saying the cast is safe. It is safe because of Zod — the database
    // itself had no opinion, so a bad row from a migration, a manual fix or a
    // future write path would flow into that cast unchallenged. These CHECKs
    // make the database agree with the contract.
    // Values mirror `Severity`, `FindingCategory` and `FindingKind` in
    // vendor/shared/contracts/findings.ts EXACTLY. If one of those enums gains a
    // member, this CHECK is the second edit — a mismatch shows up as an insert
    // that fails at runtime, so change them together.
    severityCk: check(
      'findings_severity_ck',
      sql`${t.severity} in ('CRITICAL','WARNING','SUGGESTION')`,
    ),
    categoryCk: check(
      'findings_category_ck',
      sql`${t.category} in ('bug','security','perf','style','test')`,
    ),
    kindCk: check(
      'findings_kind_ck',
      sql`${t.kind} in ('finding','secret_leak','lethal_trifecta','phantom','hook')`,
    ),
    // Confidence is a probability. Grounding and the low-confidence UI filter
    // both treat it as one.
    confidenceCk: check(
      'findings_confidence_ck',
      sql`${t.confidence} >= 0 and ${t.confidence} <= 1`,
    ),
  }),
);

/**
 * The derived intent of one PR (L03). Owned by `modules/intent`.
 *
 * Two halves, and the split is the feature: `summary`/`in_scope`/`out_of_scope`
 * are what the MODEL claimed; everything from `confidence` down is what the
 * SERVER computed or observed around that claim. A model asked to report its own
 * sources invents them, so `sources` and `missing_context` are never in the
 * model-facing schema at all.
 *
 * Tenancy: no `workspace_id` here (nor before L03). Every read and write scopes
 * through the PR — resolve `getPull(db, workspaceId, prId)` first and never
 * query this table on a bare `prId` taken from a request.
 *
 * `intent` was renamed to `summary` in migration 0015, along with the ten added
 * columns. Safe because the table had never been written to: `upsertIntent` had
 * existed with zero callers since the starter.
 */
export const prIntent = pgTable(
  'pr_intent',
  {
    prId: uuid('pr_id')
      .primaryKey()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    /** One sentence: what this PR is for. Renamed from `intent` in 0015. */
    summary: text('summary').notNull(),
    inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),

    // ---- server-computed provenance ----------------------------------------
    /**
     * How much the classifier trusts its answer, after the server's floor is
     * applied. `text` + CHECK rather than a PG enum, matching
     * `findings_severity_ck` above: the value set is business logic, and a
     * CHECK is one `ALTER` to change where an enum type is a migration dance.
     */
    confidence: text('confidence', { enum: ['high', 'medium', 'low'] })
      .notNull()
      .default('low'),
    /**
     * Every input the derivation considered, used or not. Mirrors `IntentSource`
     * in `vendor/shared/contracts/review-api.ts`; typed structurally here
     * because no other schema file imports a contract.
     */
    sources: jsonb('sources')
      .$type<
        {
          kind: 'pr_title' | 'pr_body' | 'linked_issue' | 'repo_file' | 'link' | 'changed_files';
          ref: string;
          status: 'used' | 'unavailable';
          note?: string | null;
        }[]
      >()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** What could NOT be read. The record that a gap was a gap, not invention. */
    missingContext: jsonb('missing_context').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** The commit this was derived against; a moved head makes the row stale. */
    headSha: text('head_sha').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    derivedAt: timestamp('derived_at', { withTimezone: true }).defaultNow().notNull(),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    /** null = UNKNOWN price, 0 = free. Never coalesced to 0 anywhere. */
    costUsd: doublePrecision('cost_usd'),
  },
  (t) => ({
    // ONE EDIT IN TWO PLACES with `IntentConfidence` in
    // vendor/shared/contracts/review-api.ts. Add a member to the Zod enum
    // without adding it here and the insert fails at runtime with
    // `new row for relation "pr_intent" violates check constraint`.
    confidenceCk: check('pr_intent_confidence_ck', sql`${t.confidence} in ('high','medium','low')`),
  }),
);

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
});

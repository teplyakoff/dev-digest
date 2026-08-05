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

export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
});

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
});

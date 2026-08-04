import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  doublePrecision,
  integer,
  vector,
  index,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';
import { skills } from './skills';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

/**
 * One extraction run over a repo. Exists so the numbers that decide whether the
 * extractor is trustworthy live somewhere durable: `proposed` vs `kept` is the
 * per-scan hallucination rate, and `dropped` says which check each casualty
 * failed. Without it the only honest answer to "how good is this feature" would
 * be whatever was on screen at the time.
 */
export const conventionScans = pgTable(
  'convention_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    /**
     * The SHA the samples were read at. Every evidence permalink pins to it, so
     * a snippet and the GitHub line it links to stay the same bytes after the
     * branch moves on.
     */
    indexedSha: text('indexed_sha').notNull(),
    sampledFiles: jsonb('sampled_files').$type<string[]>().notNull(),
    configFiles: jsonb('config_files').$type<string[]>().notNull(),
    /** What the model returned, BEFORE evidence verification. */
    proposed: integer('proposed').notNull(),
    /** What survived it. */
    kept: integer('kept').notNull(),
    dropped: jsonb('dropped').$type<{ rule: string; reason: string }[]>().notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    // NULL means UNKNOWN, 0 means the scan was free — the same rule the run
    // tables follow. Never collapse the two.
    costUsd: doublePrecision('cost_usd'),
    createdAt: now(),
  },
  (t) => ({ repoIdx: index('convention_scans_repo_idx').on(t.repoId) }),
);

export const conventions = pgTable(
  'conventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scanId: uuid('scan_id').references(() => conventionScans.id, { onDelete: 'cascade' }),
    category: text('category').notNull().default('other'),
    rule: text('rule').notNull(),
    evidencePath: text('evidence_path'),
    evidenceStartLine: integer('evidence_start_line'),
    evidenceEndLine: integer('evidence_end_line'),
    /**
     * Read from the clone at [start, end] — NEVER what the model wrote. The
     * extraction schema does not even have a field for a model-authored snippet,
     * which is what makes a fabricated one unrepresentable rather than merely
     * unlikely.
     */
    evidenceSnippet: text('evidence_snippet'),
    confidence: doublePrecision('confidence'),
    /**
     * Replaces the starter's `accepted boolean` (dropped in migration 0013; the
     * table had never held a row). A boolean cannot tell "not reviewed yet" from
     * "rejected", and "a rejected candidate never reaches the skill" is the claim
     * this feature is judged on — it needs the third state to be observable.
     */
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
      .notNull()
      .default('pending'),
    /** Set once the candidate has been merged into a skill. */
    skillId: uuid('skill_id').references(() => skills.id, { onDelete: 'set null' }),
    createdAt: now(),
  },
  (t) => ({ repoIdx: index('conventions_repo_idx').on(t.repoId) }),
);

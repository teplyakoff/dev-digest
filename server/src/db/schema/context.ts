import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  vector,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { repos } from './repos';
import { agents } from './agents';
import { skills } from './skills';

// ============================================================ Context & codebase

/**
 * `symbols.name` and `references.to_symbol` are btree-indexed
 * (`symbols_repo_name_idx`, `references_repo_decl_symbol_idx`). Postgres rejects
 * any index row larger than ~2704 bytes, so a pathological multi-KB "name" from
 * a bad parse (e.g. a whole expression captured as an identifier) crashes the
 * indexer with `index row size … exceeds btree version 4 maximum`. Real
 * identifiers are short, so clamp these values well under the limit before
 * insert. 255 chars ≤ ~1 KB even for 4-byte code points — comfortably safe.
 */
export const MAX_INDEXED_NAME_LEN = 255;
export const clampIndexedName = (s: string): string =>
  s.length > MAX_INDEXED_NAME_LEN ? s.slice(0, MAX_INDEXED_NAME_LEN) : s;

export const codeChunks = pgTable(
  'code_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    source: text('source', { enum: ['code', 'docs', 'spec'] }).notNull().default('code'),
  },
  (t) => ({ repoIdx: index('code_chunks_repo_idx').on(t.repoId) }),
);

/**
 * `symbols` — declared identifiers (functions/classes/methods/etc.) per repo.
 *
 * T2 extension: added `endLine`, `exported`, `signature`,
 * `contentHash`. The new columns are nullable / defaulted so existing inserts
 * (blast/service.ts `persistSymbols`) keep typechecking; the T2 indexer
 * pipeline will backfill them on the next `refreshIndex`.
 *
 * `line` carries the `start_line` semantics — kept as-is so existing
 * rows survive the migration. The composite UNIQUE prevents duplicate
 * (repo, path, name, kind, line) tuples once the indexer takes over.
 */
export const symbols = pgTable(
  'symbols',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    line: integer('line'), // = start_line
    endLine: integer('end_line'), // [T2] NEW
    exported: boolean('exported').notNull().default(false), // [T2] NEW
    signature: text('signature'), // [T2] NEW
    contentHash: text('content_hash'), // [T2] NEW (nullable — backfilled by indexer)
  },
  (t) => ({
    lookupIdx: index('symbols_repo_path_idx').on(t.repoId, t.path),
    nameIdx: index('symbols_repo_name_idx').on(t.repoId, t.name),
    uq: uniqueIndex('symbols_repo_path_name_kind_line_uq').on(
      t.repoId,
      t.path,
      t.name,
      t.kind,
      t.line,
    ),
  }),
);

/**
 * `references` — call-sites / usages of symbols.
 *
 * T2 extension: added `declFile` (NULL = unresolved → feeds the
 * Phantom-gate) and `contentHash`. The legacy columns are untouched, so
 * blast/service.ts `persistReferences` keeps working.
 */
export const references = pgTable(
  'references',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    fromPath: text('from_path').notNull(), // = ref_file
    toSymbol: text('to_symbol').notNull(), // = symbol_name
    line: integer('line').notNull(), // = ref_line
    declFile: text('decl_file'), // [T2] NEW — NULL = unresolved (Phantom-gate)
    contentHash: text('content_hash'), // [T2] NEW
  },
  (t) => ({
    byDecl: index('references_repo_decl_symbol_idx').on(
      t.repoId,
      t.declFile,
      t.toSymbol,
    ),
    byFile: index('references_repo_from_idx').on(t.repoId, t.fromPath),
  }),
);

export const onboarding = pgTable('onboarding', {
  repoId: uuid('repo_id')
    .primaryKey()
    .references(() => repos.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ============================================================ Project context (L06)

/**
 * `context_docs` — the project-context store: `.md` documents a person curates
 * per repository, attached to agents and skills, fed into the review prompt's
 * `specs` slot.
 *
 * The body lives HERE and not in the clone, and that is a correctness decision
 * rather than a preference: `adapters/git/simple-git.ts` resyncs a clone with
 * `git reset --hard origin/<branch>`, which deletes anything written into the
 * working tree without reporting it. A store whose contents vanish on the next
 * poll is not a store.
 *
 * Distinct from `code_chunks` above in every way that matters: those are machine
 * -produced, embedded and disposable; these are hand-curated, editable and the
 * only thing an agent's `specs` slot is built from. `code_chunks` stays empty —
 * chunking and embeddings are a non-goal of SPEC-06.
 */
export const contextDocs = pgTable(
  'context_docs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    /**
     * Unique per repo. The name is what the prompt orders by, what the run trace
     * records in `specs_read`, and what a person types when they talk about the
     * document — so two documents cannot share one inside a repo.
     */
    name: text('name').notNull(),
    body: text('body').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    repoIdx: index('context_docs_repo_idx').on(t.repoId),
    workspaceIdx: index('context_docs_workspace_idx').on(t.workspaceId),
    nameUq: uniqueIndex('context_docs_repo_name_uq').on(t.repoId, t.name),
  }),
);

/**
 * `agent_context_docs` — which documents one agent carries into its prompt.
 *
 * A pure join with a composite primary key: the same document cannot be attached
 * to the same agent twice, and there is nothing else to say about the pair. The
 * composite PK indexes `agent_id` on its own; `doc_id` gets its own index because
 * the deletion path and the "which agents use this document" read both start
 * from that side.
 */
export const agentContextDocs = pgTable(
  'agent_context_docs',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    docId: uuid('doc_id')
      .notNull()
      .references(() => contextDocs.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.docId] }),
    docIdx: index('agent_context_docs_doc_idx').on(t.docId),
  }),
);

/**
 * `skill_context_docs` — which documents ride along with one skill.
 *
 * Attaching a document to a skill decides only WHETHER its text is included in a
 * run that loads that skill. It does NOT promote the text to the skill's trust
 * level: a body reaches the model through the wrapped `specs` slot either way,
 * never through `PromptParts.skills`, which the engine documents as trusted
 * configuration.
 */
export const skillContextDocs = pgTable(
  'skill_context_docs',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    docId: uuid('doc_id')
      .notNull()
      .references(() => contextDocs.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.skillId, t.docId] }),
    docIdx: index('skill_context_docs_doc_idx').on(t.docId),
  }),
);

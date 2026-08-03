import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';

export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Slug-shaped and unique per workspace (see the index below): the name is
    // the block heading the model reads and the label in the run trace, so two
    // skills sharing one makes both ambiguous.
    name: text('name').notNull(),
    description: text('description').notNull(),
    type: text('type', { enum: ['rubric', 'convention', 'security', 'custom'] }).notNull(),
    // 'imported_file' = an upload that went through the import preview. It is
    // the only source that lands disabled.
    source: text('source', {
      enum: ['manual', 'imported_url', 'imported_file', 'extracted', 'community'],
    }).notNull(),
    body: text('body').notNull(),
    // The master switch. A disabled skill loads for NO agent, which is what
    // makes "disabled → absent from the prompt and the trace" one observable
    // fact instead of a per-agent audit. The run LOG is deliberately the
    // exception: it says the skill was linked and skipped, because a silent log
    // is where "why is my skill not in the prompt?" goes unanswered
    // (`run-executor.ts` → `resolveSkills`).
    enabled: boolean('enabled').notNull().default(true),
    version: integer('version').notNull().default(1),
    evidenceFiles: jsonb('evidence_files').$type<string[]>(),
    createdAt: now(),
  },
  (t) => ({
    workspaceIdx: index('skills_workspace_id_idx').on(t.workspaceId),
    nameUq: uniqueIndex('skills_workspace_id_name_uq').on(t.workspaceId, t.name),
  }),
);

export const skillVersions = pgTable(
  'skill_versions',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    body: text('body').notNull(),
    createdAt: now(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.skillId, t.version] }) }),
);

import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * F1 — workspace data-access. Reads the repos of one workspace for the overview
 * screen. Scoped by `workspaceId`, like every query in this codebase (onion §8).
 */

export type RepoRow = typeof t.repos.$inferSelect;

export class WorkspaceRepository {
  constructor(private db: Db) {}

  async listRepos(workspaceId: string): Promise<RepoRow[]> {
    return this.db.select().from(t.repos).where(eq(t.repos.workspaceId, workspaceId));
  }
}

import { and, eq } from 'drizzle-orm';
import type { Db, DbTx } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * F1 — polling data-access. Owns the PR-list sync write and the
 * `repos.last_polled_at` stamp.
 *
 * The upsert is intentionally identical in shape to `PullsRepository.upsertPull`
 * and NOT shared with it: two features must not import each other's repository
 * (onion §11), and these two writes drift for good reasons — the polling sync
 * has no `opened_at` to record, because GitHub's list payload for an existing PR
 * does not restate it.
 */

export type RepoRow = typeof t.repos.$inferSelect;

export interface SyncPull {
  number: number;
  title: string;
  author: string;
  branch: string;
  base: string;
  head_sha: string;
  additions: number;
  deletions: number;
  files_count: number;
  status: typeof t.pullRequests.$inferSelect['status'];
  updated_at?: string | null;
}

export class PollingRepository {
  constructor(private db: Db) {}

  async getRepo(workspaceId: string, repoId: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  async upsertPull(
    workspaceId: string,
    repoId: string,
    pr: SyncPull,
    tx?: DbTx,
  ): Promise<void> {
    const invoker = tx ?? this.db;
    await invoker
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: pr.number,
        title: pr.title,
        author: pr.author,
        branch: pr.branch,
        base: pr.base,
        headSha: pr.head_sha,
        additions: pr.additions,
        deletions: pr.deletions,
        filesCount: pr.files_count,
        status: pr.status,
        updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
      })
      .onConflictDoUpdate({
        target: [t.pullRequests.repoId, t.pullRequests.number],
        set: {
          title: pr.title,
          headSha: pr.head_sha,
          status: pr.status,
          updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
        },
      });
  }

  async markPolled(repoId: string, at: Date, tx?: DbTx): Promise<void> {
    const invoker = tx ?? this.db;
    await invoker.update(t.repos).set({ lastPolledAt: at }).where(eq(t.repos.id, repoId));
  }
}

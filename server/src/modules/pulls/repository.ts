import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db, DbTx } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * F1 — pulls data-access layer. The ONLY place that touches `pull_requests`,
 * `pr_files` and `pr_commits`, plus the read-time joins the PR list needs off
 * `reviews`, `findings` and `agent_runs`.
 *
 * Extracted from `routes.ts`, which used to run all of this inline in two
 * handlers (onion §9: a handler parses, delegates, and maps a status code).
 *
 * Tenancy: every entry point takes `workspaceId` and every query filters on it,
 * either directly or through a repo/PR row this class already scoped. A query
 * without it is a data-leak bug, not a style preference (§8).
 */

export type PullRow = typeof t.pullRequests.$inferSelect;
export type RepoRow = typeof t.repos.$inferSelect;
export type PrFileRow = typeof t.prFiles.$inferSelect;
export type PrCommitRow = typeof t.prCommits.$inferSelect;

/** One PR as GitHub's list endpoint describes it. */
export interface UpsertPull {
  number: number;
  title: string;
  author: string;
  branch: string;
  base: string;
  head_sha: string;
  additions: number;
  deletions: number;
  files_count: number;
  status: PullRow['status'];
  opened_at?: string | null;
  updated_at?: string | null;
}

/** A review row reduced to what the PR list's SCORE column needs. */
export interface LatestReviewRow {
  id: string;
  prId: string;
  score: number | null;
}

/** A findings row reduced to what the PR list's severity counters need. */
export interface ListFindingRow {
  reviewId: string;
  severity: string;
  category: string;
  title: string;
  file: string;
  startLine: number;
  endLine: number;
  confidence: number;
  rationale: string;
}

export class PullsRepository {
  constructor(private db: Db) {}

  // ---- Repos + pulls -------------------------------------------------------

  async getRepo(workspaceId: string, repoId: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /**
   * The repo a PR belongs to. Unscoped by design: the only callers already
   * resolved the PR through `getPull`, which IS workspace-scoped, so the repo id
   * is derived from a row this workspace owns.
   */
  async getRepoOfPull(repoId: string): Promise<RepoRow | undefined> {
    const [row] = await this.db.select().from(t.repos).where(eq(t.repos.id, repoId));
    return row;
  }

  async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  async listByRepo(repoId: string): Promise<PullRow[]> {
    return this.db.select().from(t.pullRequests).where(eq(t.pullRequests.repoId, repoId));
  }

  /**
   * Import a PR, idempotently. The unique index on (repo_id, number) makes a
   * re-import an update of the fields that actually move — title, head sha,
   * status, updated_at — and leaves everything else alone.
   */
  async upsertPull(
    workspaceId: string,
    repoId: string,
    pr: UpsertPull,
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
        ...(pr.opened_at !== undefined
          ? { openedAt: pr.opened_at ? new Date(pr.opened_at) : null }
          : {}),
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

  async updateDiffStats(
    prId: string,
    stats: { additions: number; deletions: number; filesCount: number },
    tx?: DbTx,
  ): Promise<void> {
    const invoker = tx ?? this.db;
    await invoker.update(t.pullRequests).set(stats).where(eq(t.pullRequests.id, prId));
  }

  async updateDetail(
    prId: string,
    detail: { body: string | null; additions: number; deletions: number; filesCount: number },
    tx?: DbTx,
  ): Promise<void> {
    const invoker = tx ?? this.db;
    await invoker.update(t.pullRequests).set(detail).where(eq(t.pullRequests.id, prId));
  }

  // ---- Files + commits -----------------------------------------------------

  async listFiles(prId: string): Promise<PrFileRow[]> {
    return this.db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
  }

  async listCommits(prId: string): Promise<PrCommitRow[]> {
    return this.db.select().from(t.prCommits).where(eq(t.prCommits.prId, prId));
  }

  /** Delete-then-insert: GitHub's detail payload is the whole truth for a PR. */
  async replaceFiles(
    prId: string,
    files: { path: string; additions: number; deletions: number; patch: string | null }[],
    tx?: DbTx,
  ): Promise<void> {
    const invoker = tx ?? this.db;
    await invoker.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
    if (files.length > 0) {
      await invoker.insert(t.prFiles).values(files.map((f) => ({ prId, ...f })));
    }
  }

  async replaceCommits(
    prId: string,
    commits: { sha: string; message: string; author: string; committedAt: Date | null }[],
    tx?: DbTx,
  ): Promise<void> {
    const invoker = tx ?? this.db;
    await invoker.delete(t.prCommits).where(eq(t.prCommits.prId, prId));
    if (commits.length > 0) {
      await invoker.insert(t.prCommits).values(commits.map((c) => ({ prId, ...c })));
    }
  }

  // ---- Read-time joins for the PR list ------------------------------------
  // Three narrow reads instead of one wide join: the list is small, and keeping
  // them separate lets each be indexed for its own predicate. Rows come back
  // newest-first so the caller takes the first per PR (see helpers.ts).

  /**
   * Every 'review'-kind review for these PRs, newest first.
   *
   * Takes the tenant key rather than trusting the ids to carry it. They do
   * today — the caller derived them from a workspace-scoped repo — but §8 makes
   * that a parameter on purpose: the next caller with a wider id list would
   * otherwise read across workspaces and nothing here would notice.
   */
  async reviewsForPulls(workspaceId: string, prIds: string[]): Promise<LatestReviewRow[]> {
    if (prIds.length === 0) return [];
    return this.db
      .select({ id: t.reviews.id, prId: t.reviews.prId, score: t.reviews.score })
      .from(t.reviews)
      .where(
        and(
          eq(t.reviews.workspaceId, workspaceId),
          inArray(t.reviews.prId, prIds),
          eq(t.reviews.kind, 'review'),
        ),
      )
      .orderBy(desc(t.reviews.createdAt));
  }

  /**
   * Completed runs for these PRs, newest first. Only 'done' qualifies: a
   * failed, cancelled or in-flight run has no settled cost, and the column
   * means "the last successful spend".
   */
  async completedRunCosts(
    workspaceId: string,
    prIds: string[],
  ): Promise<{ prId: string | null; costUsd: number | null }[]> {
    if (prIds.length === 0) return [];
    return this.db
      .select({ prId: t.agentRuns.prId, costUsd: t.agentRuns.costUsd })
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          inArray(t.agentRuns.prId, prIds),
          eq(t.agentRuns.status, 'done'),
        ),
      )
      .orderBy(desc(t.agentRuns.ranAt));
  }

  /**
   * Slim findings for the list's severity counters and their hover popup.
   *
   * Scoped transitively, like `getRepoOfPull` above: `findings` carries no
   * workspace column of its own, and these ids come straight out of
   * `reviewsForPulls`, which is tenant-scoped. Pass ids from anywhere else and
   * that guarantee is gone.
   */
  async findingsForReviews(reviewIds: string[]): Promise<ListFindingRow[]> {
    if (reviewIds.length === 0) return [];
    return this.db
      .select({
        reviewId: t.findings.reviewId,
        severity: t.findings.severity,
        category: t.findings.category,
        title: t.findings.title,
        file: t.findings.file,
        startLine: t.findings.startLine,
        endLine: t.findings.endLine,
        confidence: t.findings.confidence,
        rationale: t.findings.rationale,
      })
      .from(t.findings)
      .where(inArray(t.findings.reviewId, reviewIds));
  }
}

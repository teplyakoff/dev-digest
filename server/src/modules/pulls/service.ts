import type {
  GitHubClient,
  PrDetail,
  PrMeta,
  PrReviewComment,
  PrCommentInput,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { PullsRepository, type PullRow, type RepoRow } from './repository.js';
import {
  findingsByReview,
  latestCostByPr,
  latestReviewByPr,
  needingDiffStats,
  toPrDetail,
  toPrMeta,
} from './helpers.js';
import { DIFF_STAT_BACKFILL_LIMIT } from './constants.js';

/**
 * F1 — pulls service. PR import and read.
 *
 * LOCAL-FIRST is the rule that shapes every method here: GitHub is a refresh, not
 * a dependency. When a token is missing or the network is down, reads fall back
 * to whatever was persisted (seeded or previously imported) and the UI keeps
 * working offline. Only posting a comment — which has no local meaning — fails
 * loudly without GitHub.
 *
 * Extracted from `routes.ts`, which held all of this inline across two handlers.
 */

/** The subset of the logger this service uses (§5: structural, not the concrete type). */
type Logger = { warn: (obj: unknown, msg?: string) => void };

export class PullsService {
  private repo: PullsRepository;

  constructor(
    private container: Container,
    private log: Logger,
  ) {
    this.repo = new PullsRepository(container.db);
  }

  /**
   * The PR list for one repo: sync from GitHub when possible, then assemble the
   * list's derived columns (review status, score, cost, severity counters).
   */
  async listForRepo(workspaceId: string, repoId: string): Promise<PrMeta[]> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const gh = await this.githubOrNull('serving persisted PRs');
    if (gh) await this.syncPulls(gh, workspaceId, repo);

    let rows = await this.repo.listByRepo(repo.id);
    if (gh) rows = await this.backfillDiffStats(gh, repo, rows);

    return this.assembleList(workspaceId, rows);
  }

  /**
   * Full PR detail. Refreshes files/commits/body from GitHub when a token is
   * configured; otherwise serves the persisted copy.
   */
  async getDetail(workspaceId: string, prId: string): Promise<PrDetail> {
    const { pr, repo } = await this.resolvePrAndRepo(workspaceId, prId);

    try {
      const gh = await this.container.github();
      const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pr.number);

      // One transaction: files, commits and the PR row describe a single
      // snapshot of the PR. A crash between the deletes and the inserts would
      // otherwise leave the detail page showing a PR with no files at all.
      await this.container.db.transaction(async (tx) => {
        await this.repo.replaceFiles(
          pr.id,
          detail.files.map((f) => ({
            path: f.path,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch ?? null,
          })),
          tx,
        );
        await this.repo.replaceCommits(
          pr.id,
          detail.commits.map((c) => ({
            sha: c.sha,
            message: c.message,
            author: c.author,
            committedAt: c.committed_at ? new Date(c.committed_at) : null,
          })),
          tx,
        );
        await this.repo.updateDetail(
          pr.id,
          {
            body: detail.body ?? null,
            // Diff stats are absent from GitHub's PR-LIST payload — take them
            // from this detail fetch so the list shows real size/files.
            additions: detail.additions,
            deletions: detail.deletions,
            filesCount: detail.files_count,
          },
          tx,
        );
      });

      return { ...detail, id: pr.id };
    } catch (err) {
      this.log.warn(
        { err },
        'GitHub PR detail refresh skipped (no token / offline); serving persisted detail',
      );
      const [files, commits] = await Promise.all([
        this.repo.listFiles(pr.id),
        this.repo.listCommits(pr.id),
      ]);
      return toPrDetail(pr, files, commits);
    }
  }

  /**
   * Inline review comments, proxied live to GitHub with no local mirror — so the
   * Files-changed tab is always in lock-step with the PR rather than with a
   * cache nobody invalidates. Degrades to an empty list rather than an error:
   * "no comments to show" beats a broken tab.
   */
  async listComments(workspaceId: string, prId: string): Promise<PrReviewComment[]> {
    const { pr, repo } = await this.resolvePrAndRepo(workspaceId, prId);
    const gh = await this.githubOrNull('serving no PR comments');
    if (!gh) return [];
    try {
      return await gh.listReviewComments({ owner: repo.owner, name: repo.name }, pr.number);
    } catch (err) {
      this.log.warn({ err }, 'GitHub review-comments fetch skipped (offline / error)');
      return [];
    }
  }

  /** Post an inline comment. Unlike the reads, this cannot degrade. */
  async createComment(
    workspaceId: string,
    prId: string,
    input: PrCommentInput,
  ): Promise<PrReviewComment> {
    const { pr, repo } = await this.resolvePrAndRepo(workspaceId, prId);

    let gh: GitHubClient;
    try {
      gh = await this.container.github();
    } catch {
      throw new AppError('github_unavailable', 'Connect a GitHub token to post comments.', 400);
    }

    try {
      return await gh.createReviewComment({ owner: repo.owner, name: repo.name }, pr.number, {
        commitId: pr.headSha,
        path: input.path,
        line: input.line,
        ...(input.side ? { side: input.side } : {}),
        body: input.body,
        ...(input.in_reply_to != null ? { inReplyTo: input.in_reply_to } : {}),
      });
    } catch (err) {
      // GitHub rejects comments on lines outside the diff, and on closed PRs (422).
      const msg = err instanceof Error ? err.message : 'Failed to post the comment to GitHub.';
      throw new AppError('github_comment_failed', msg, 400, { cause: String(err) });
    }
  }

  // ---- internals -----------------------------------------------------------

  private async resolvePrAndRepo(
    workspaceId: string,
    prId: string,
  ): Promise<{ pr: PullRow; repo: RepoRow }> {
    const pr = await this.repo.getPull(workspaceId, prId);
    if (!pr) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepoOfPull(pr.repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return { pr, repo };
  }

  /**
   * The GitHub client, or null when none is configured. Every read path treats
   * "no token" as a degraded mode rather than a failure (onion §10), so this
   * returns null instead of throwing.
   */
  private async githubOrNull(fallbackNote: string): Promise<GitHubClient | null> {
    try {
      return await this.container.github();
    } catch (err) {
      this.log.warn({ err }, `GitHub client unavailable (no token / offline); ${fallbackNote}`);
      return null;
    }
  }

  private async syncPulls(gh: GitHubClient, workspaceId: string, repo: RepoRow): Promise<void> {
    try {
      const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
      for (const pr of pulls) {
        await this.repo.upsertPull(workspaceId, repo.id, pr);
      }
    } catch (err) {
      this.log.warn({ err }, 'GitHub PR sync skipped (no token / offline); serving persisted PRs');
    }
  }

  /**
   * Repair zeroed diff stats from the detail endpoint, capped per request.
   * Returns the rows with the repaired values applied in memory, so the response
   * reflects the backfill without a second read.
   */
  private async backfillDiffStats(
    gh: GitHubClient,
    repo: RepoRow,
    rows: PullRow[],
  ): Promise<PullRow[]> {
    const stale = needingDiffStats(rows, DIFF_STAT_BACKFILL_LIMIT);
    if (stale.length === 0) return rows;

    const repaired = new Map<string, { additions: number; deletions: number; filesCount: number }>();
    for (const r of stale) {
      try {
        const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, r.number);
        const stats = {
          additions: detail.additions,
          deletions: detail.deletions,
          filesCount: detail.files_count,
        };
        await this.repo.updateDiffStats(r.id, stats);
        repaired.set(r.id, stats);
      } catch (err) {
        this.log.warn({ err, number: r.number }, 'PR diff-stat backfill skipped');
      }
    }

    return rows.map((r) => (repaired.has(r.id) ? { ...r, ...repaired.get(r.id)! } : r));
  }

  /**
   * The list's derived columns. Three narrow reads plus in-memory grouping, not
   * one wide join: the list is small, and each read is indexed for its own
   * predicate.
   */
  private async assembleList(workspaceId: string, rows: PullRow[]): Promise<PrMeta[]> {
    const prIds = rows.map((r) => r.id);

    const [reviewRows, runRows] = await Promise.all([
      this.repo.reviewsForPulls(workspaceId, prIds),
      this.repo.completedRunCosts(workspaceId, prIds),
    ]);

    const reviews = latestReviewByPr(reviewRows);
    const costs = latestCostByPr(runRows);
    const findings = findingsByReview(
      await this.repo.findingsForReviews([...reviews.values()].map((rv) => rv.id)),
    );

    const now = Date.now();
    return rows.map((r) =>
      toPrMeta(r, {
        review: reviews.get(r.id),
        cost: costs.get(r.id) ?? null,
        findingsByReviewId: findings,
        now,
      }),
    );
  }
}

import type { PrDetail, PrListFinding, PrMeta } from '@devdigest/shared';
import type {
  LatestReviewRow,
  ListFindingRow,
  PrCommitRow,
  PrFileRow,
  PullRow,
} from './repository.js';
import { deriveReviewStatus } from './status.js';
import { countBySeverity } from './severity.js';

/**
 * Pure read-time aggregation for the PR list.
 *
 * These three used to be inline blocks in the `GET /repos/:id/pulls` handler,
 * interleaved with the queries that fed them. Split out they are ring 0 — data
 * in, data out — so they are tested by calling them, with no app, no container
 * and no Docker (onion §12).
 */

/** The newest review per PR. Input MUST be ordered newest-first. */
export function latestReviewByPr(
  rows: LatestReviewRow[],
): Map<string, { id: string; score: number | null }> {
  const out = new Map<string, { id: string; score: number | null }>();
  for (const rv of rows) {
    if (!out.has(rv.prId)) out.set(rv.prId, { id: rv.id, score: rv.score });
  }
  return out;
}

/**
 * The newest completed run's cost per PR. Input MUST be ordered newest-first.
 *
 * `has` rather than a truthiness check, deliberately: `cost_usd = null` means
 * UNKNOWN and `0` means the run was free, so the newest run wins even when its
 * cost is null. Collapsing the two would print "$0.00" for a run nobody priced.
 */
export function latestCostByPr(
  rows: { prId: string | null; costUsd: number | null }[],
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const run of rows) {
    if (run.prId && !out.has(run.prId)) out.set(run.prId, run.costUsd);
  }
  return out;
}

/**
 * Findings grouped by the review that produced them.
 *
 * The severity/category casts are safe because every write path goes through the
 * `Finding` contract — and, since the 0011 migration, because the database has
 * CHECK constraints spelling out the same values.
 */
export function findingsByReview(rows: ListFindingRow[]): Map<string, PrListFinding[]> {
  const out = new Map<string, PrListFinding[]>();
  for (const f of rows) {
    const list = out.get(f.reviewId) ?? [];
    list.push({
      severity: f.severity as PrListFinding['severity'],
      category: f.category as PrListFinding['category'],
      title: f.title,
      file: f.file,
      start_line: f.startLine,
      end_line: f.endLine,
      confidence: f.confidence,
      rationale: f.rationale,
    });
    out.set(f.reviewId, list);
  }
  return out;
}

/**
 * One row → one `PrMeta`.
 *
 * The null-vs-empty distinction on the last two fields is load-bearing: `null`
 * means this PR was never reviewed, while a reviewed-clean PR gets real zeros
 * and an empty list. The UI renders those differently.
 */
export function toPrMeta(
  r: PullRow,
  ctx: {
    review: { id: string; score: number | null } | undefined;
    cost: number | null;
    findingsByReviewId: Map<string, PrListFinding[]>;
    now: number;
  },
): PrMeta {
  const { review, cost, findingsByReviewId, now } = ctx;
  const findings = review ? (findingsByReviewId.get(review.id) ?? []) : null;
  return {
    id: r.id,
    number: r.number,
    title: r.title,
    author: r.author,
    branch: r.branch,
    base: r.base,
    head_sha: r.headSha,
    additions: r.additions,
    deletions: r.deletions,
    files_count: r.filesCount,
    status: deriveReviewStatus({
      ghStatus: r.status,
      lastReviewedSha: r.lastReviewedSha,
      headSha: r.headSha,
      updatedAt: r.updatedAt,
      now,
    }),
    opened_at: r.openedAt?.toISOString() ?? null,
    updated_at: r.updatedAt?.toISOString() ?? null,
    score: review ? review.score : null,
    cost_usd: cost,
    findings_by_severity: findings ? countBySeverity(findings) : null,
    latest_findings: findings,
  };
}

/** The persisted (offline / no-token) shape of `GET /pulls/:id`. */
export function toPrDetail(pr: PullRow, files: PrFileRow[], commits: PrCommitRow[]): PrDetail {
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    author: pr.author,
    branch: pr.branch,
    base: pr.base,
    head_sha: pr.headSha,
    additions: pr.additions,
    deletions: pr.deletions,
    files_count: pr.filesCount,
    status: pr.status as PrDetail['status'],
    opened_at: pr.openedAt?.toISOString() ?? null,
    updated_at: pr.updatedAt?.toISOString() ?? null,
    body: pr.body ?? null,
    files: files.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ?? null,
    })),
    commits: commits.map((c) => ({
      sha: c.sha,
      message: c.message,
      author: c.author,
      committed_at: c.committedAt?.toISOString() ?? null,
    })),
  };
}

/**
 * PRs whose diff stats are still zeroed.
 *
 * GitHub's PR-LIST payload carries no diff stats, so a freshly imported PR lands
 * with zeroed size and the list would show "0 files, ±0". Each backfill costs one
 * detail fetch, so a request repairs at most `limit` of them and the periodic
 * refetch chips away at the rest.
 */
export function needingDiffStats(rows: PullRow[], limit: number): PullRow[] {
  return rows
    .filter((r) => r.additions === 0 && r.deletions === 0 && r.filesCount === 0)
    .slice(0, limit);
}

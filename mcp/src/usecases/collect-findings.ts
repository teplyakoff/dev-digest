import type { FindingCategory, FindingRecord, ReviewRecord, Severity } from '@devdigest/shared';
import type { ApiClient } from '../api/types.js';
import type { Resolver } from '../resolve.js';

/**
 * Ring 2 — resolve → fetch → scope to runs → union → filter → paginate. Six
 * dependent steps and a loop, which is onion §9's own definition of "this body
 * is a service, not a handler".
 */

export type FindingStatus = 'open' | 'accepted' | 'dismissed' | 'all';

export interface FindingsQuery {
  pullRequest: string;
  severity?: Severity | undefined;
  category?: FindingCategory | undefined;
  pathContains?: string | undefined;
  status: FindingStatus;
  limit: number;
  offset: number;
  /** false = the newest review row of each agent. true = every run this PR ever had. */
  allRuns: boolean;
}

export interface FindingsPage {
  /** `acme/payments-api#482` when it could be resolved, else the raw ref. */
  label: string;
  /** Findings across every review row IN SCOPE, before filtering. */
  total: number;
  /** Findings that matched the filters. */
  matched: number;
  items: FindingRecord[];
  /** The agents whose review rows contributed, newest run first. */
  agents: string[];
  /** Review rows a superseded run contributed that `allRuns: false` left out. */
  hiddenRuns: number;
}

export async function collectFindings(
  query: FindingsQuery,
  api: ApiClient,
  resolver: Resolver,
  signal?: AbortSignal,
): Promise<FindingsPage> {
  const { pullId, repo, pull } = await resolver.pull(query.pullRequest, signal);
  const reviews = await api.listReviews(pullId, signal);

  /*
   * `reviews` rows are plain INSERTs — `repository/review.repo.ts:25` never
   * upserts — so re-running an agent APPENDS a row rather than replacing one.
   * Two axes therefore have to be kept apart, and conflating them is how this
   * tool goes wrong in both directions:
   *
   *   across agents — union, always. One Run Review writes one row PER AGENT,
   *     so narrowing to a single row reports whichever agent finished last. On
   *     teplyakoff/dev-digest#5 that was the API Contract Reviewer with 0
   *     findings on a PR that really had 13 (`server/INSIGHTS.md:343-356`).
   *
   *   across runs OF ONE AGENT — the newest wins by default. Older rows are a
   *     superseded verdict on the same diff, and reporting them beside the
   *     current one double-counts findings the agent has already re-decided.
   *
   * `allRuns: true` keeps the history; the count that was dropped travels back
   * as `hiddenRuns` so the caller is told what it is not seeing rather than
   * left to infer it from a total that quietly shrank.
   */
  const reviewRows = [...reviews.filter((r) => r.kind === 'review')].sort(newestFirst);
  const inScope = query.allRuns ? reviewRows : latestRunPerAgent(reviewRows);

  const agents: string[] = [];
  const all: FindingRecord[] = [];
  for (const row of inScope) {
    const name = row.agent_name ?? row.agent_id ?? 'unknown agent';
    if (!agents.includes(name)) agents.push(name);
    all.push(...row.findings);
  }

  const matched = all.filter((f) => matches(f, query));
  const items = matched.slice(query.offset, query.offset + query.limit);

  return {
    label: repo && pull ? `${repo.full_name}#${pull.number}` : query.pullRequest,
    total: all.length,
    matched: matched.length,
    items,
    agents,
    hiddenRuns: reviewRows.length - inScope.length,
  };
}

/**
 * Newest first. Returns 0 rather than `NaN` on an unparseable or equal
 * `created_at`, which keeps the sort stable — ties hold the order the API
 * returned (`reviewsForPull` already orders `createdAt DESC`), instead of
 * depending on comparator behaviour that is not specified for `NaN`.
 */
function newestFirst(a: ReviewRecord, b: ReviewRecord): number {
  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  if (Number.isNaN(ta) || Number.isNaN(tb) || ta === tb) return 0;
  return tb - ta;
}

/**
 * One row per agent, keeping the newest — the input must already be sorted.
 *
 * The key falls back through `agent_id` → the name → the row's own id, and that
 * last step is not a formality: rows whose agent has been deleted carry a null
 * `agent_id` AND a null `agent_name`, and keying those together would collapse
 * every orphaned review in a PR's history into one. Unattributable rows each
 * keep their own key and so all survive.
 */
function latestRunPerAgent(newestFirstRows: ReviewRecord[]): ReviewRecord[] {
  const seen = new Set<string>();
  const kept: ReviewRecord[] = [];
  for (const row of newestFirstRows) {
    const key = row.agent_id ?? (row.agent_name ? `name:${row.agent_name}` : `row:${row.id}`);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(row);
  }
  return kept;
}

function matches(f: FindingRecord, q: FindingsQuery): boolean {
  if (q.severity && f.severity !== q.severity) return false;
  if (q.category && f.category !== q.category) return false;
  if (q.pathContains && !f.file.toLowerCase().includes(q.pathContains.toLowerCase())) return false;
  switch (q.status) {
    case 'open':
      return f.accepted_at === null && f.dismissed_at === null;
    case 'accepted':
      return f.accepted_at !== null;
    case 'dismissed':
      return f.dismissed_at !== null;
    case 'all':
      return true;
  }
}

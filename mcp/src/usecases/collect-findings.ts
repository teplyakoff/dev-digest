import type { FindingCategory, FindingRecord, Severity } from '@devdigest/shared';
import type { ApiClient } from '../api/types.js';
import type { Resolver } from '../resolve.js';

/**
 * Ring 2 — resolve → fetch → union → filter → paginate. Five dependent steps
 * and a loop, which is onion §9's own definition of "this body is a service,
 * not a handler".
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
}

export interface FindingsPage {
  /** `acme/payments-api#482` when it could be resolved, else the raw ref. */
  label: string;
  /** Findings across EVERY review row, before filtering. */
  total: number;
  /** Findings that matched the filters. */
  matched: number;
  items: FindingRecord[];
  /** The agents whose review rows contributed, in the order they were read. */
  agents: string[];
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
   * THE correctness risk in this tool, and it has already been paid for once
   * (`server/INSIGHTS.md:343-356`): ONE ROW IN `reviews` IS ONE AGENT, not one
   * review pass. A Run Review writes a `kind: 'review'` row per agent, so
   * `reviews.find(r => r.kind === 'review')` — the obvious code — reports the
   * agent that happened to finish LAST. On teplyakoff/dev-digest#5 that was the
   * API Contract Reviewer with 0 findings, on a PR that really had 13.
   *
   * So: union every `kind: 'review'` row. The knowing cost is that a re-run
   * agent's superseded findings stay visible until its older review is deleted —
   * the same trade `modules/smart-diff/service.ts` made.
   */
  const reviewRows = reviews.filter((r) => r.kind === 'review');
  const agents: string[] = [];
  const all: FindingRecord[] = [];
  for (const row of reviewRows) {
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
  };
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

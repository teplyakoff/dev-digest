import { describe, it, expect } from 'vitest';
import {
  findingsByReview,
  latestCostByPr,
  latestReviewByPr,
  needingDiffStats,
  toPrMeta,
} from '../src/modules/pulls/helpers.js';
import type { PullRow } from '../src/modules/pulls/repository.js';

/**
 * The PR list's read-time aggregation.
 *
 * These four functions were inline blocks inside the `GET /repos/:id/pulls`
 * handler, so the only way to reach them was an integration test with a real
 * Postgres. Extracting them to `helpers.ts` (onion §9) makes them ring 0 — this
 * whole file runs with no app, no container and no Docker.
 */

const NOW = Date.parse('2026-08-03T12:00:00Z');

function pull(over: Partial<PullRow> = {}): PullRow {
  return {
    id: 'pr-1',
    workspaceId: 'ws-1',
    repoId: 'repo-1',
    number: 1,
    title: 'Add rate limiting',
    author: 'octocat',
    branch: 'feat/rate-limit',
    base: 'main',
    headSha: 'abc123',
    additions: 10,
    deletions: 2,
    filesCount: 3,
    status: 'open',
    body: null,
    lastReviewedSha: null,
    openedAt: new Date(NOW - 86_400_000),
    updatedAt: new Date(NOW - 3_600_000),
    ...over,
  } as PullRow;
}

describe('latestReviewByPr', () => {
  it('keeps the FIRST row per PR, because rows arrive newest-first', () => {
    const out = latestReviewByPr([
      { id: 'rv-new', prId: 'pr-1', score: 80 },
      { id: 'rv-old', prId: 'pr-1', score: 30 },
      { id: 'rv-other', prId: 'pr-2', score: 55 },
    ]);
    expect(out.get('pr-1')).toEqual({ id: 'rv-new', score: 80 });
    expect(out.get('pr-2')).toEqual({ id: 'rv-other', score: 55 });
  });

  it('keeps a null score — "reviewed, unscored" is not "never reviewed"', () => {
    const out = latestReviewByPr([{ id: 'rv-1', prId: 'pr-1', score: null }]);
    expect(out.has('pr-1')).toBe(true);
    expect(out.get('pr-1')!.score).toBeNull();
  });
});

describe('latestCostByPr', () => {
  it('takes the newest run per PR', () => {
    const out = latestCostByPr([
      { prId: 'pr-1', costUsd: 0.0016 },
      { prId: 'pr-1', costUsd: 0.5 },
    ]);
    expect(out.get('pr-1')).toBe(0.0016);
  });

  // The distinction the whole cost feature rests on: null = UNKNOWN (render
  // "—"), 0 = the run was genuinely free. A newest-run-wins implementation
  // written with a truthiness check would skip past BOTH and report a stale cost.
  it('lets a newest run with cost null win over an older priced run', () => {
    const out = latestCostByPr([
      { prId: 'pr-1', costUsd: null },
      { prId: 'pr-1', costUsd: 0.42 },
    ]);
    expect(out.get('pr-1')).toBeNull();
  });

  it('lets a newest run with cost 0 win, and keeps it as 0 not null', () => {
    const out = latestCostByPr([
      { prId: 'pr-1', costUsd: 0 },
      { prId: 'pr-1', costUsd: 0.42 },
    ]);
    expect(out.get('pr-1')).toBe(0);
  });

  it('ignores runs with no PR (agent runs not tied to a pull request)', () => {
    expect(latestCostByPr([{ prId: null, costUsd: 1 }]).size).toBe(0);
  });
});

describe('findingsByReview', () => {
  it('groups by review and maps the DB row to the list shape', () => {
    const out = findingsByReview([
      {
        reviewId: 'rv-1', severity: 'CRITICAL', category: 'security', title: 'SQL injection',
        file: 'src/db.ts', startLine: 10, endLine: 12, confidence: 0.9, rationale: 'unescaped',
      },
      {
        reviewId: 'rv-1', severity: 'WARNING', category: 'perf', title: 'N+1',
        file: 'src/api.ts', startLine: 4, endLine: 4, confidence: 0.6, rationale: 'loop query',
      },
      {
        reviewId: 'rv-2', severity: 'SUGGESTION', category: 'style', title: 'naming',
        file: 'src/x.ts', startLine: 1, endLine: 1, confidence: 0.3, rationale: 'unclear',
      },
    ]);
    expect(out.get('rv-1')).toHaveLength(2);
    expect(out.get('rv-2')).toHaveLength(1);
    expect(out.get('rv-1')![0]).toEqual({
      severity: 'CRITICAL', category: 'security', title: 'SQL injection',
      file: 'src/db.ts', start_line: 10, end_line: 12, confidence: 0.9, rationale: 'unescaped',
    });
  });
});

describe('toPrMeta', () => {
  const empty = new Map<string, never[]>();

  // null vs zero, again — this time on the counters. A PR nobody reviewed and a
  // PR reviewed clean look identical if these collapse, and the UI renders them
  // differently on purpose.
  it('never reviewed → score, counters and findings are all null', () => {
    const meta = toPrMeta(pull(), {
      review: undefined, cost: null, findingsByReviewId: empty, now: NOW,
    });
    expect(meta.score).toBeNull();
    expect(meta.findings_by_severity).toBeNull();
    expect(meta.latest_findings).toBeNull();
  });

  it('reviewed clean → real zero counters and an empty list, not null', () => {
    const meta = toPrMeta(pull(), {
      review: { id: 'rv-1', score: 100 }, cost: 0, findingsByReviewId: empty, now: NOW,
    });
    expect(meta.score).toBe(100);
    expect(meta.latest_findings).toEqual([]);
    expect(meta.findings_by_severity).not.toBeNull();
    expect(Object.values(meta.findings_by_severity!).every((n) => n === 0)).toBe(true);
    expect(meta.cost_usd).toBe(0);
  });

  it('serialises timestamps as ISO strings and nulls absent ones', () => {
    const meta = toPrMeta(pull({ openedAt: null }), {
      review: undefined, cost: null, findingsByReviewId: empty, now: NOW,
    });
    expect(meta.opened_at).toBeNull();
    expect(meta.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('needingDiffStats', () => {
  it('selects only rows where all three stats are zero', () => {
    const rows = [
      pull({ id: 'a', additions: 0, deletions: 0, filesCount: 0 }),
      pull({ id: 'b', additions: 0, deletions: 0, filesCount: 2 }),
      pull({ id: 'c', additions: 5, deletions: 0, filesCount: 0 }),
    ];
    expect(needingDiffStats(rows, 10).map((r) => r.id)).toEqual(['a']);
  });

  // Each backfill is a separate GitHub detail fetch, so the cap is what keeps
  // the first load of a busy repo from turning into dozens of serial API calls.
  it('caps the batch at the limit', () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      pull({ id: `pr-${i}`, additions: 0, deletions: 0, filesCount: 0 }),
    );
    expect(needingDiffStats(rows, 10)).toHaveLength(10);
  });
});

import { describe, it, expect } from 'vitest';
import type { SmartDiff, SmartDiffFile } from '@devdigest/shared';
import { SmartDiffService } from '../src/modules/smart-diff/service.js';
import {
  LARGE_FILE_LINES,
  ROLE_ORDER,
  SEVERITY_RANK,
} from '../src/modules/smart-diff/constants.js';
import { NotFoundError } from '../src/platform/errors.js';
import type { Container } from '../src/platform/container.js';
import type {
  FindingRow,
  PullRow,
  ReviewRepository,
  ReviewRow,
} from '../src/modules/reviews/repository.js';

/**
 * `SmartDiffService.get` — the group / order / join, with a stubbed container.
 *
 * NO DOCKER, BY DESIGN. This is a ring-2 use case, so it gets override doubles
 * and no database (`.claude/skills/onion-architecture/SKILL.md` §12: "a use-case
 * test that needs a database is a boundary report"). Everything the service
 * reads arrives through `container.reviewRepo`, so three async functions are the
 * whole fixture. Stub-literal precedent: `repo-intel-resync.test.ts:48`.
 *
 * The thresholds and the severity ranking are IMPORTED from `constants.ts`, not
 * restated. That is what makes that file load-bearing: move `LARGE_FILE_LINES`
 * and these tests move with it, instead of failing on a number nobody meant to
 * pin here.
 *
 * The stub's `llm()` throws AND records. That is the machine-checkable half of
 * "Smart Diff makes no model call": the other half is structural (no LLM adapter
 * is reachable from `service.ts`) and cannot be asserted from here.
 */

// Row shapes are taken from the repository's own signatures rather than
// re-declared, so a schema change breaks these fixtures at compile time.
type PrFileRow = Awaited<ReturnType<ReviewRepository['getPrFiles']>>[number];
type ReviewWithFindings = Awaited<ReturnType<ReviewRepository['reviewsForPull']>>[number];

const WS = 'ws-1';
const PR = 'pr-1';

function fileRow(path: string, additions: number, deletions = 0): PrFileRow {
  return { id: `file-${path}`, prId: PR, path, additions, deletions, patch: null };
}

let findingSeq = 0;
function findingRow(over: {
  file: string;
  severity?: string;
  startLine?: number;
  title?: string;
  reviewId?: string;
}): FindingRow {
  const line = over.startLine ?? 10;
  return {
    id: `fd-${findingSeq++}`,
    reviewId: over.reviewId ?? 'rv-review',
    file: over.file,
    startLine: line,
    endLine: line,
    severity: over.severity ?? 'WARNING',
    category: 'bug',
    title: over.title ?? 'Unbounded loop',
    rationale: 'grounded elsewhere; this service never re-grounds',
    suggestion: null,
    confidence: 0.9,
    kind: 'finding',
    trifectaComponents: null,
    acceptedAt: null,
    dismissedAt: null,
  };
}

function reviewRow(id: string, kind: 'review' | 'summary'): ReviewRow {
  return {
    id,
    workspaceId: WS,
    prId: PR,
    agentId: null,
    runId: null,
    kind,
    verdict: null,
    summary: null,
    score: 80,
    model: null,
    createdAt: new Date('2026-08-07T10:00:00Z'),
  };
}

/** One `kind: 'review'` row carrying these findings — the common fixture. */
function reviewWith(findings: FindingRow[]): ReviewWithFindings[] {
  return [{ review: reviewRow('rv-review', 'review'), findings }];
}

interface Harness {
  service: SmartDiffService;
  /** Provider ids `container.llm()` was asked for. Must stay empty, always. */
  llmCalls: string[];
  /** Repository methods that were actually reached, in order. */
  reads: string[];
  logs: { obj: unknown; msg?: string }[];
}

function makeService(opts: {
  files?: PrFileRow[];
  reviews?: ReviewWithFindings[];
  /** `false` → `getPull` resolves undefined, i.e. another workspace's PR. */
  pullExists?: boolean;
} = {}): Harness {
  const llmCalls: string[] = [];
  const reads: string[] = [];
  const logs: { obj: unknown; msg?: string }[] = [];

  const container = {
    reviewRepo: {
      getPull: async (): Promise<PullRow | undefined> => {
        reads.push('getPull');
        return (opts.pullExists ?? true) ? ({ id: PR, workspaceId: WS } as PullRow) : undefined;
      },
      getPrFiles: async () => {
        reads.push('getPrFiles');
        return opts.files ?? [];
      },
      reviewsForPull: async () => {
        reads.push('reviewsForPull');
        return opts.reviews ?? [];
      },
    },
    // Reaching this is the failure, so it is loud as well as recorded: a
    // silently-counted call would let a green suite ship a billed endpoint.
    llm: async (id: string) => {
      llmCalls.push(id);
      throw new Error(`SmartDiffService called container.llm(${id}) — it must cost zero tokens`);
    },
  } as unknown as Container;

  return {
    service: new SmartDiffService(container),
    llmCalls,
    reads,
    logs,
  };
}

/** Paths of one group, in the order the service emitted them. */
function pathsOf(diff: SmartDiff, role: string): string[] {
  return (diff.groups.find((g) => g.role === role)?.files ?? []).map((f) => f.path);
}

function fileAt(diff: SmartDiff, path: string): SmartDiffFile | undefined {
  return diff.groups.flatMap((g) => g.files).find((f) => f.path === path);
}

describe('SmartDiffService.get — grouping and the finding join', () => {
  it('emits groups in ROLE_ORDER and joins each finding onto its file by path', async () => {
    const h = makeService({
      // Deliberately boilerplate-first: if the service emitted groups in row
      // order rather than ROLE_ORDER, this fixture is what exposes it.
      files: [
        fileRow('pnpm-lock.yaml', 900, 100),
        fileRow('README.md', 4, 1),
        fileRow('src/checkout.ts', 30, 5),
      ],
      reviews: reviewWith([
        findingRow({ file: 'src/checkout.ts', startLine: 52, title: 'Missing tenant filter' }),
        findingRow({ file: 'src/checkout.ts', startLine: 12, severity: 'CRITICAL' }),
        // Same line twice — `finding_lines` de-duplicates, `findings` does not.
        findingRow({ file: 'src/checkout.ts', startLine: 12, severity: 'SUGGESTION' }),
      ]),
    });

    const diff = await h.service.get(WS, PR, { info: (obj, msg) => h.logs.push({ obj, msg }) });

    expect(diff.groups.map((g) => g.role)).toEqual([...ROLE_ORDER]);
    expect(pathsOf(diff, 'core')).toEqual(['src/checkout.ts']);
    expect(pathsOf(diff, 'wiring')).toEqual(['README.md']);
    expect(pathsOf(diff, 'boilerplate')).toEqual(['pnpm-lock.yaml']);

    const core = fileAt(diff, 'src/checkout.ts')!;
    expect(core.findings).toHaveLength(3);
    expect(core.findings.map((f) => f.title)).toContain('Missing tenant filter');
    // `finding_lines` is DERIVED from `findings`: sorted, de-duplicated, and
    // never gathered separately. The contract makes both required precisely so
    // the two cannot drift.
    expect(core.finding_lines).toEqual([12, 52]);

    // A file with no findings gets an empty list, not a missing one.
    expect(fileAt(diff, 'README.md')!.findings).toEqual([]);
    expect(fileAt(diff, 'README.md')!.finding_lines).toEqual([]);

    // total_lines is every file's additions + deletions, boilerplate included.
    expect(diff.split_suggestion.total_lines).toBe(900 + 100 + 4 + 1 + 30 + 5);
    expect(diff.split_suggestion.proposed_splits).toEqual([]);

    expect(h.llmCalls).toEqual([]);
  });

  it('never reaches container.llm() — the zero-token guarantee, machine-checked', async () => {
    const h = makeService({
      files: [fileRow('src/a.ts', 10), fileRow('package.json', 2)],
      reviews: reviewWith([findingRow({ file: 'src/a.ts' })]),
    });

    // The stub's llm() throws, so a call would surface as a rejection here
    // rather than only as an empty-array assertion below.
    await expect(h.service.get(WS, PR)).resolves.toBeTruthy();
    expect(h.llmCalls).toEqual([]);
  });

  it('omits a role with no files instead of emitting an empty group', async () => {
    const h = makeService({
      files: [fileRow('src/a.ts', 10), fileRow('dist/a.js', 300)],
    });

    const diff = await h.service.get(WS, PR);

    expect(diff.groups.map((g) => g.role)).toEqual(['core', 'boilerplate']);
    expect(diff.groups.every((g) => g.files.length > 0)).toBe(true);
  });

  // REPLACES 'takes the first kind=review row, not the newest row'. That test
  // pinned the wrong model of the data: it read one row as one review PASS,
  // when a row is one AGENT. On the imported PR `d139cd8b` the newest row was an
  // agent with 0 findings and the endpoint reported 0 of the PR's real 13, so
  // the old assertion was pinning the bug rather than the behaviour.
  it('joins findings from EVERY kind=review row — a row is one agent, not one review pass', async () => {
    const h = makeService({
      files: [fileRow('src/checkout.ts', 30), fileRow('src/pricing.ts', 10)],
      // Newest-first, and shaped like the real PR: the agent that finished LAST
      // found nothing. Reading only that row returns an empty Smart Diff while
      // two other agents' findings sit one row behind it.
      reviews: [
        { review: reviewRow('rv-api-contract', 'review'), findings: [] },
        {
          review: reviewRow('rv-tests', 'review'),
          findings: [
            findingRow({ file: 'src/checkout.ts', startLine: 52, title: 'Test gap' }),
            findingRow({ file: 'src/pricing.ts', startLine: 8, title: 'No pricing test' }),
          ],
        },
        {
          review: reviewRow('rv-general', 'review'),
          findings: [
            findingRow({
              file: 'src/checkout.ts',
              startLine: 12,
              severity: 'CRITICAL',
              title: 'Missing tenant filter',
            }),
            findingRow({ file: 'src/gone.ts', title: 'nowhere to anchor' }),
          ],
        },
      ],
    });

    const diff = await h.service.get(WS, PR, { info: (obj, msg) => h.logs.push({ obj, msg }) });

    const checkout = fileAt(diff, 'src/checkout.ts')!;
    expect(checkout.findings.map((f) => f.title).sort()).toEqual([
      'Missing tenant filter',
      'Test gap',
    ]);
    // Derived across the union, not per review row.
    expect(checkout.finding_lines).toEqual([12, 52]);
    expect(fileAt(diff, 'src/pricing.ts')!.findings.map((f) => f.title)).toEqual([
      'No pricing test',
    ]);
    expect(diff.groups.flatMap((g) => g.files).flatMap((f) => f.findings)).toHaveLength(3);

    // The join reads across rows, so `unmatched` has to accumulate across rows
    // too — a per-row counter would report 0 here and hide the mismatch.
    expect(h.logs[0]!.obj).toMatchObject({
      files: 2,
      reviews_joined: 3,
      findings: 3,
      unmatched: 1,
    });
    // `latest_review_id` is GONE from the log on purpose: with findings coming
    // from many rows, one id names only the agent that finished last and reads
    // as provenance it no longer has.
    expect(h.logs[0]!.obj).not.toHaveProperty('latest_review_id');
    expect(h.llmCalls).toEqual([]);
  });

  it('never joins a kind=summary row, even when the summary is the newest row', async () => {
    const h = makeService({
      files: [fileRow('src/checkout.ts', 30)],
      // `reviewsForPull` is newest-first and returns BOTH kinds. A summary row
      // sits in front of the review rows, exactly as it does after a real run.
      // Unioning the review rows must not quietly widen to "every row".
      reviews: [
        {
          review: reviewRow('rv-summary', 'summary'),
          findings: [findingRow({ file: 'src/checkout.ts', title: 'FROM THE SUMMARY ROW' })],
        },
        {
          review: reviewRow('rv-review-a', 'review'),
          findings: [findingRow({ file: 'src/checkout.ts', title: 'FROM REVIEW A' })],
        },
        {
          review: reviewRow('rv-review-b', 'review'),
          findings: [findingRow({ file: 'src/checkout.ts', title: 'FROM REVIEW B' })],
        },
      ],
    });

    const diff = await h.service.get(WS, PR, { info: (obj, msg) => h.logs.push({ obj, msg }) });

    expect(fileAt(diff, 'src/checkout.ts')!.findings.map((f) => f.title).sort()).toEqual([
      'FROM REVIEW A',
      'FROM REVIEW B',
    ]);
    expect(JSON.stringify(diff)).not.toContain('FROM THE SUMMARY ROW');
    // Two of the three rows were joined — the summary is excluded from the
    // count as well as from the findings.
    expect(h.logs[0]!.obj).toMatchObject({ reviews_joined: 2, findings: 2 });
  });

  // The chosen trade-off, pinned so it cannot be "fixed" silently: re-running
  // one agent leaves the superseded run's row in place, and its findings stay
  // visible. De-duplication and "newest row per agent" were both offered and
  // declined — neither has a rule for "the same finding" that the data carries.
  // Changing this behaviour means changing this test AND the comment in
  // `service.ts` that records the decision.
  it('keeps a superseded agent run visible rather than de-duplicating it', async () => {
    const h = makeService({
      files: [fileRow('src/checkout.ts', 30)],
      reviews: [
        {
          review: reviewRow('rv-security-rerun', 'review'),
          findings: [findingRow({ file: 'src/checkout.ts', startLine: 12, title: 'Same finding' })],
        },
        {
          review: reviewRow('rv-security-first', 'review'),
          findings: [findingRow({ file: 'src/checkout.ts', startLine: 12, title: 'Same finding' })],
        },
      ],
    });

    const diff = await h.service.get(WS, PR);

    const checkout = fileAt(diff, 'src/checkout.ts')!;
    expect(checkout.findings.map((f) => f.title)).toEqual(['Same finding', 'Same finding']);
    // Distinct ids, so the click-through still resolves each to its own run.
    expect(new Set(checkout.findings.map((f) => f.id)).size).toBe(2);
    // `finding_lines` de-duplicates regardless — it is a line set, and two
    // findings on line 12 are one rail.
    expect(checkout.finding_lines).toEqual([12]);
  });

  it('still groups and orders a PR that has never been reviewed, with empty findings', async () => {
    const h = makeService({
      files: [fileRow('src/z.ts', 5), fileRow('src/a.ts', 50), fileRow('README.md', 1)],
      reviews: [],
    });

    const diff = await h.service.get(WS, PR, { info: (obj, msg) => h.logs.push({ obj, msg }) });

    // Sorting works before any review exists — that is the point of the feature
    // being computed rather than generated.
    expect(pathsOf(diff, 'core')).toEqual(['src/a.ts', 'src/z.ts']);
    expect(diff.groups.flatMap((g) => g.files).every((f) => f.findings.length === 0)).toBe(true);
    expect(diff.groups.flatMap((g) => g.files).every((f) => f.finding_lines.length === 0)).toBe(
      true,
    );
    // Nothing was joined, and the log says so as a count of what was read.
    expect(h.logs[0]!.obj).toMatchObject({ reviews_joined: 0, findings: 0, unmatched: 0 });
  });

  it('drops a finding whose file matches no PR file — counted in the log, never a phantom file', async () => {
    const h = makeService({
      files: [fileRow('src/checkout.ts', 30)],
      reviews: reviewWith([
        findingRow({ file: 'src/checkout.ts' }),
        findingRow({ file: 'src/deleted-elsewhere.ts', title: 'nowhere to anchor' }),
      ]),
    });

    const diff = await h.service.get(WS, PR, { info: (obj, msg) => h.logs.push({ obj, msg }) });

    const paths = diff.groups.flatMap((g) => g.files).map((f) => f.path);
    expect(paths).toEqual(['src/checkout.ts']);
    expect(JSON.stringify(diff)).not.toContain('nowhere to anchor');
    // Dropped is not the same as ignored: the count is what answers "can the two
    // producers disagree on path form?" on real data.
    expect(h.logs[0]!.obj).toMatchObject({ files: 1, findings: 1, unmatched: 1 });
  });

  it('throws NotFoundError — and reads nothing — when the PR is not in this workspace', async () => {
    const h = makeService({ pullExists: false, files: [fileRow('src/a.ts', 10)] });

    await expect(h.service.get(WS, PR)).rejects.toBeInstanceOf(NotFoundError);
    // The tenancy gate is the FIRST statement for a reason: `getPrFiles` and
    // `reviewsForPull` take a PR id and cannot scope themselves, so reaching
    // either before the ownership check is a cross-tenant read.
    expect(h.reads).toEqual(['getPull']);
  });
});

describe('SmartDiffService.get — intra-group order', () => {
  it('ranks a file WITH findings above a larger file with none', async () => {
    const h = makeService({
      // Both other sort keys favour `src/a.ts`: it is far bigger and sorts first
      // by path. Only the findings key can produce the expected order, so a
      // comparator sign flip here cannot hide behind a tie-break.
      files: [fileRow('src/a.ts', 400, 100), fileRow('src/z.ts', 3, 0)],
      reviews: reviewWith([findingRow({ file: 'src/z.ts' })]),
    });

    const diff = await h.service.get(WS, PR);

    expect(pathsOf(diff, 'core')).toEqual(['src/z.ts', 'src/a.ts']);
  });

  it('orders files that all have findings by SEVERITY_RANK, worst first', async () => {
    const cases = [
      { path: 'src/a-suggestion.ts', severity: 'SUGGESTION' },
      { path: 'src/b-critical.ts', severity: 'CRITICAL' },
      { path: 'src/c-warning.ts', severity: 'WARNING' },
    ];
    const h = makeService({
      // Identical sizes, so severity is the only key left after "has findings".
      files: cases.map((c) => fileRow(c.path, 20)),
      reviews: reviewWith(cases.map((c) => findingRow({ file: c.path, severity: c.severity }))),
    });

    const diff = await h.service.get(WS, PR);

    // The oracle is the constant, not a hardcoded list: this asserts the service
    // HONOURS `SEVERITY_RANK`, so re-ranking severities in one place moves both.
    const expected = [...cases]
      .sort((x, y) => SEVERITY_RANK[x.severity]! - SEVERITY_RANK[y.severity]!)
      .map((c) => c.path);
    expect(pathsOf(diff, 'core')).toEqual(expected);
    expect(expected).toEqual(['src/b-critical.ts', 'src/c-warning.ts', 'src/a-suggestion.ts']);
  });

  it('orders two finding-free files by changed lines, more first', async () => {
    const h = makeService({
      // Path order would give the opposite answer, so this pins the size key.
      files: [fileRow('src/a.ts', 5, 5), fileRow('src/z.ts', 60, 40)],
    });

    const diff = await h.service.get(WS, PR);

    expect(pathsOf(diff, 'core')).toEqual(['src/z.ts', 'src/a.ts']);
  });

  it('breaks a total tie on path ascending, so the same PR always renders the same way', async () => {
    const h = makeService({
      // Equal on every other key, fed in deliberately shuffled order. Without
      // the tie-break the result is row order — the demo films a different list
      // each take, and every other ordering assertion becomes luck.
      files: [fileRow('src/c.ts', 10, 2), fileRow('src/a.ts', 10, 2), fileRow('src/b.ts', 10, 2)],
    });

    const diff = await h.service.get(WS, PR);

    expect(pathsOf(diff, 'core')).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });
});

describe('SmartDiffService.get — is_large', () => {
  it(`is false at exactly LARGE_FILE_LINES (${LARGE_FILE_LINES}) and true one line above`, async () => {
    const h = makeService({
      files: [
        fileRow('src/exactly-at.ts', LARGE_FILE_LINES, 0),
        fileRow('src/one-over.ts', LARGE_FILE_LINES + 1, 0),
      ],
    });

    const diff = await h.service.get(WS, PR);

    // The threshold is `>`, not `>=`. Hardcoding 200 here would defeat the
    // check: the constant moving must move the boundary this test walks.
    expect(fileAt(diff, 'src/exactly-at.ts')!.is_large).toBe(false);
    expect(fileAt(diff, 'src/one-over.ts')!.is_large).toBe(true);
  });

  it('counts additions + deletions, not additions alone', async () => {
    const h = makeService({
      // Additions alone are BELOW the threshold; the sum is one line above it.
      // A rule reading only `additions` returns false and looks plausible.
      files: [fileRow('src/mostly-deletions.ts', LARGE_FILE_LINES - 1, 2)],
    });

    const diff = await h.service.get(WS, PR);

    expect(fileAt(diff, 'src/mostly-deletions.ts')!.is_large).toBe(true);
  });
});

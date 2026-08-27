/**
 * Grounding — the citation gate — pinned by the VALUE of what it returns.
 *
 * The package had no test for `groundFindings` at all; `run.test.ts` only ever
 * observed it through `reviewPullRequest`'s counts. This file exists because
 * L06 made `rangeIntersects` public (`grounding.ts:41`), and NFR-3's threshold
 * for "the export changed nothing" is *zero divergences, checked by equality of
 * values, not by `not.toContain`* — the same rule `reviewer-core/INSIGHTS.md:38-46`
 * records for prompt slots, and for the same reason: an absence check passes
 * while the output quietly reorders, grows a field, or rewords a reason, which
 * is exactly the drift that makes "no behaviour change" unverifiable.
 *
 * So `kept` and `dropped` are asserted as whole arrays, in order, with their
 * reason strings spelled out. A change to grounding is then a diff in this file
 * — deliberate and visible — rather than a silent one.
 *
 * `groundFindings` is one of the package's two safety gates (`AGENTS.md`, *Do
 * not touch*). Nothing here may be relaxed to make an unrelated change pass.
 */
import { describe, it, expect } from 'vitest';
import type { Finding, UnifiedDiff } from '@devdigest/shared';
import { groundFindings, groundingSummary, rangeIntersects } from '../src/index.js';

/**
 * Two files, and two different hunk shapes on purpose:
 *  - `src/config.ts` carries explicit `newLineNumbers` (the normal path);
 *  - `src/util.ts` carries none, so the index falls back to the hunk's declared
 *    `newStart` / `newLines` range (`grounding.ts:31-33`).
 */
const DIFF: UnifiedDiff = {
  raw: '(fixture)',
  files: [
    {
      path: 'src/config.ts',
      additions: 3,
      deletions: 0,
      hunks: [
        {
          file: 'src/config.ts',
          oldStart: 10,
          oldLines: 0,
          newStart: 10,
          newLines: 3,
          newLineNumbers: [10, 11, 12],
        },
      ],
    },
    {
      path: 'src/util.ts',
      additions: 3,
      deletions: 0,
      hunks: [
        {
          file: 'src/util.ts',
          oldStart: 50,
          oldLines: 0,
          newStart: 50,
          newLines: 3,
          newLineNumbers: [],
        },
      ],
    },
  ],
};

function finding(id: string, file: string, start: number, end: number, over: Partial<Finding> = {}): Finding {
  return {
    id,
    severity: 'WARNING',
    category: 'bug',
    title: `finding ${id}`,
    file,
    start_line: start,
    end_line: end,
    rationale: 'because',
    confidence: 0.7,
    kind: 'finding',
    ...over,
  };
}

/** One finding per behaviour the gate has. Order matters — it is asserted. */
const IN_HUNK = finding('in-hunk', 'src/config.ts', 11, 11);
const HALLUCINATED = finding('hallucinated', 'src/config.ts', 999, 999);
const MISSING_FILE = finding('missing-file', 'src/other.ts', 1, 1);
const SECRET_OUTSIDE_HUNK = finding('secret', 'src/config.ts', 999, 1000, { kind: 'secret_leak' });
const HOOK_IN_MISSING_FILE = finding('hook', 'src/other.ts', 5, 5, { kind: 'hook' });
const REVERSED_RANGE = finding('reversed', 'src/config.ts', 12, 10);
const FALLBACK_HIT = finding('fallback-hit', 'src/util.ts', 51, 51);
const FALLBACK_MISS = finding('fallback-miss', 'src/util.ts', 60, 61);
const TOUCHES_LAST_LINE = finding('boundary', 'src/config.ts', 12, 20);
const ONE_LINE_PAST = finding('adjacent', 'src/config.ts', 13, 20);

const FINDINGS: Finding[] = [
  IN_HUNK,
  HALLUCINATED,
  MISSING_FILE,
  SECRET_OUTSIDE_HUNK,
  HOOK_IN_MISSING_FILE,
  REVERSED_RANGE,
  FALLBACK_HIT,
  FALLBACK_MISS,
  TOUCHES_LAST_LINE,
  ONE_LINE_PAST,
];

describe('groundFindings — NFR-3: the observable output, by value', () => {
  it('keeps exactly these findings, in this order', () => {
    const result = groundFindings(FINDINGS, DIFF);
    expect(result.kept).toEqual([
      IN_HUNK,
      // A full-file kind grounds on the file being present, not on a hunk —
      // line 999 does not exist and it is kept anyway (grounding.ts:66-70).
      SECRET_OUTSIDE_HUNK,
      // start > end is normalised, not rejected.
      REVERSED_RANGE,
      // No newLineNumbers → the declared newStart/newLines range is used.
      FALLBACK_HIT,
      // The last line of the hunk still counts as an intersection.
      TOUCHES_LAST_LINE,
    ]);
  });

  it('drops exactly these findings, in this order, with these reasons', () => {
    const result = groundFindings(FINDINGS, DIFF);
    expect(result.dropped).toEqual([
      {
        finding: HALLUCINATED,
        reason: "lines 999-999 do not intersect any diff hunk in 'src/config.ts'",
      },
      { finding: MISSING_FILE, reason: "file 'src/other.ts' not present in diff" },
      // Precedence: the file check runs BEFORE the full-file exemption, so a
      // hook finding in a file outside the diff is dropped for the file, not
      // admitted for its kind.
      { finding: HOOK_IN_MISSING_FILE, reason: "file 'src/other.ts' not present in diff" },
      {
        finding: FALLBACK_MISS,
        reason: "lines 60-61 do not intersect any diff hunk in 'src/util.ts'",
      },
      // One line past the hunk is out. This is the pair to TOUCHES_LAST_LINE:
      // together they pin where the boundary is, not merely that there is one.
      {
        finding: ONE_LINE_PAST,
        reason: "lines 13-20 do not intersect any diff hunk in 'src/config.ts'",
      },
    ]);
  });

  it('summarises as 5/10 and leaves its input untouched', () => {
    const input = FINDINGS.slice();
    const result = groundFindings(input, DIFF);
    expect(groundingSummary(result)).toBe('5/10 passed');
    expect(input).toEqual(FINDINGS);
  });

  it('an empty diff drops everything, and an empty finding list is not an error', () => {
    const empty: UnifiedDiff = { raw: '', files: [] };
    const allDropped = groundFindings([IN_HUNK], empty);
    expect(allDropped.kept).toEqual([]);
    expect(allDropped.dropped).toEqual([
      { finding: IN_HUNK, reason: "file 'src/config.ts' not present in diff" },
    ]);

    expect(groundFindings([], DIFF)).toEqual({ kept: [], dropped: [] });
  });
});

describe('rangeIntersects — the primitive L06 exported (AC-3, NFR-3)', () => {
  it('answers the SPARSE question: a gap between hunk lines is a real gap', () => {
    // This is what makes it the wrong tool for the scorer's contiguous ranges,
    // and the right one here: lines 10 and 20 belong to the same file's hunks
    // with nothing in between, and a range landing in the gap must be false.
    const lines = new Set([10, 20]);
    expect(rangeIntersects(lines, 10, 10)).toBe(true);
    expect(rangeIntersects(lines, 20, 25)).toBe(true);
    expect(rangeIntersects(lines, 11, 19)).toBe(false);
    expect(rangeIntersects(lines, 5, 9)).toBe(false);
  });

  it('normalises a reversed range instead of returning false', () => {
    expect(rangeIntersects(new Set([15]), 20, 10)).toBe(true);
  });

  it('is false against an empty line set', () => {
    expect(rangeIntersects(new Set<number>(), 1, 100)).toBe(false);
  });
});

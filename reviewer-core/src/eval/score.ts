import type { Finding, FindingKind } from '@devdigest/shared';

/**
 * The mechanical eval scorer (L06 / SPEC-08, AC-1…AC-14).
 *
 * Given, per case, what the case EXPECTED and what the agent actually produced,
 * it returns a per-case verdict and the micro-averaged batch metrics. It is a
 * pure function of its arguments:
 *
 *   - **zero model calls** (AC-13) — there is no provider parameter to call one
 *     with, so the absence is structural, not a promise;
 *   - **zero I/O** (NFR-1) — the only import is a contract TYPE, which erases at
 *     runtime, so this module's runtime import graph is EMPTY: nothing here reads
 *     a file, a socket, a database or `process.env`, and nothing it imports can;
 *   - **deterministic** (AC-14) — no clock, no randomness, no mutation of the
 *     arguments.
 *
 * Two decisions are load-bearing and are easy to "fix" back into being wrong:
 *
 * 1. **Micro-averaging, not a mean of per-case metrics** (AC-6…AC-9). The batch
 *    numerators and denominators are summed across every case and divided ONCE.
 *    A case expecting five findings therefore weighs five times a case expecting
 *    one, and a case that emitted twenty false positives damages `precision` by
 *    exactly how noisy it was. A macro average would flatten both effects.
 *    `per_case` metrics exist for display and for the per-run row — never as the
 *    input to the batch numbers.
 *
 * 2. **A zero denominator yields `null`, which means "unknown"** (AC-10…AC-12).
 *    It is a THIRD value: not 0, and emphatically not 1. "0 of 0 expected
 *    findings = 100% recall" is the failure this whole spec is written against —
 *    a set that measures nothing looks perfect precisely when it measures
 *    nothing. Callers must render it as unknown; `?? 0` at a call site puts the
 *    lie back.
 */

/**
 * The direction of a case. Mirrors the `EvalExpectation` Zod enum in
 * `server/src/vendor/shared/contracts/eval-ci.ts` and the `expectation` CHECK
 * constraint on `eval_cases` — one edit in three places, by design: ring 0 does
 * not import server contracts as values, and this union is the engine's copy.
 */
export type EvalExpectation = 'must_find' | 'must_not_flag';

/**
 * Full-file finding kinds. Mirrors `FULL_FILE_KINDS` in `grounding.ts:16`,
 * which is private and stays private — `groundFindings` is a safety gate and
 * this change exports one primitive from it, nothing more. Grounding admits
 * these on the file being present at all, so matching applies the same rule:
 * path equality, no line overlap required.
 */
const FULL_FILE_KINDS: ReadonlySet<string> = new Set<FindingKind>([
  'secret_leak',
  'lethal_trifecta',
  'phantom',
  'hook',
]);

/** What a case says the agent should (or should not) report, as a location. */
export interface EvalExpectedFinding {
  /** Compared character-for-character — no normalisation, no case folding (AC-1). */
  file: string;
  start_line: number;
  end_line: number;
  /** Full-file kinds match on path alone; absent/`'finding'` requires overlap. */
  kind?: FindingKind | null;
}

/** One completed case: what it expected, and what the run actually produced. */
export interface EvalCaseResult {
  /** `'must_find'` (AC-4) or `'must_not_flag'` (AC-5). */
  expectation: EvalExpectation;
  /** The case's `expected_output`. Empty for `must_not_flag` (server AC-21). */
  expected: EvalExpectedFinding[];
  /** The findings that SURVIVED grounding — `ReviewOutcome.review.findings`. */
  actual: Finding[];
  /** How many findings grounding threw away — `ReviewOutcome.dropped.length`. */
  dropped: number;
}

/** Per-case verdict plus the counts the batch is micro-averaged from. */
export interface EvalCaseScore {
  /** AC-4 / AC-5. Boolean by design — it answers "did this case get there", not "how close". */
  pass: boolean;
  expected_total: number;
  expected_matched: number;
  actual_total: number;
  actual_matched: number;
  /** = `actual_total`; named for the citation-accuracy identity it feeds. */
  grounded_kept: number;
  grounded_dropped: number;
  /** `null` = unknown (zero denominator), never 0 and never 1. */
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
}

/** Micro-averaged batch metrics. Cases that did not complete are never passed in (server AC-42). */
export interface EvalBatchScore {
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  cases_total: number;
  cases_passed: number;
  per_case: EvalCaseScore[];
}

/**
 * Do two contiguous line ranges overlap?
 *
 * Deliberately arithmetic, and deliberately NOT `rangeIntersects` from
 * `grounding.ts` — the two questions look alike and are not the same shape:
 *
 *   - grounding asks "does this range touch any of these **sparse** lines?",
 *     where the lines are the union of a file's diff hunks. A `Set` is genuinely
 *     necessary there, because the lines have gaps.
 *   - the scorer asks "do these two **contiguous** ranges overlap?", which is one
 *     comparison. Expanding a contiguous range into a `Set` of every line it
 *     covers, only to reuse a sparse-set primitive, is a category error that
 *     happens to be correct — and it is not free: it allocates one entry per line
 *     of the expected range and then loops once per line of the ACTUAL range.
 *
 * That cost is unbounded in practice, not just in theory. `Finding.start_line`
 * and `end_line` are `z.number().int()` with no upper bound
 * (`server/src/vendor/shared/contracts/findings.ts:53-54`), and the actual range
 * arrives from a fresh model response on every eval run. A single hallucinated
 * `end_line: 999999999` would be an unbounded allocation plus an unbounded loop,
 * N times per batch.
 *
 * **AC-3 is satisfied by equivalence, not by reuse.** The criterion requires the
 * same overlap VERDICT as grounding on the same input ranges — not the same code
 * — and the proof is the differential test named in the spec's Traceability row
 * for AC-3: a table of ranges run through both paths, asserting equal verdicts.
 * If that test ever goes red, this function is what changed, not grounding.
 *
 * Both ranges are normalised for `start > end` first, exactly as
 * `rangeIntersects` does with `Math.min` / `Math.max`, so a reversed range is a
 * range (spec Edge cases).
 */
function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  const aLo = Math.min(aStart, aEnd);
  const aHi = Math.max(aStart, aEnd);
  const bLo = Math.min(bStart, bEnd);
  const bHi = Math.max(bStart, bEnd);
  return Math.max(aLo, bLo) <= Math.min(aHi, bHi);
}

function isFullFile(kind: FindingKind | null | undefined): boolean {
  return kind ? FULL_FILE_KINDS.has(kind) : false;
}

/**
 * AC-1: same file, character-for-character, AND overlapping `[start_line, end_line]`.
 *
 * The full-file short-circuit fires when EITHER side carries a full-file kind,
 * and the two halves have different standing — stated here so a later reader does
 * not have to re-derive it, and so that being wrong is visible:
 *
 *   - **expected side** — confirmed by the spec. Its Open questions record that a
 *     case expecting a `secret_leak` matches on the path itself, because
 *     grounding does not require line overlap for those kinds
 *     (`grounding.ts:16,66-70`), which also means "the secret is on line 12
 *     exactly" is not expressible.
 *   - **actual side** — a deliberate extension for symmetry, NOT something the
 *     spec states. An agent that reports a `secret_leak` against a line-scoped
 *     expectation on the same file counts as a hit. The reading is that the
 *     Edge-cases row says "a finding with a full-file kind", without saying whose
 *     finding. If it should be expected-side only, this is the line to change.
 */
function matches(expected: EvalExpectedFinding, actual: Finding): boolean {
  if (expected.file !== actual.file) return false;
  if (isFullFile(expected.kind) || isFullFile(actual.kind)) return true;
  return rangesOverlap(expected.start_line, expected.end_line, actual.start_line, actual.end_line);
}

/**
 * Score one completed case.
 *
 * Matching is a single greedy pass with a consumed set, which is what makes AC-2
 * true: an actual finding closes AT MOST ONE expectation, so two expectations
 * that overlap each other are not both closed by one finding — the second stays
 * unmatched and costs recall.
 *
 * A `must_not_flag` case matches nothing at all (AC-9): every surviving finding
 * is a false positive by construction, and the case contributes zero to the
 * recall denominator (AC-8).
 */
export function scoreEvalCase(result: EvalCaseResult): EvalCaseScore {
  const negative = result.expectation === 'must_not_flag';
  const expected = negative ? [] : result.expected;
  const actual = result.actual;

  let matched = 0;
  if (expected.length > 0 && actual.length > 0) {
    const consumed = new Array<boolean>(expected.length).fill(false);
    for (const a of actual) {
      for (let i = 0; i < expected.length; i++) {
        if (consumed[i]) continue;
        const e = expected[i];
        if (!e) continue;
        if (matches(e, a)) {
          consumed[i] = true;
          matched++;
          break;
        }
      }
    }
  }

  const kept = actual.length;
  const citationTotal = kept + result.dropped;

  return {
    pass: negative ? kept === 0 : matched === expected.length,
    expected_total: expected.length,
    expected_matched: matched,
    actual_total: actual.length,
    actual_matched: matched,
    grounded_kept: kept,
    grounded_dropped: result.dropped,
    recall: ratio(matched, expected.length),
    precision: ratio(matched, actual.length),
    citation_accuracy: ratio(kept, citationTotal),
  };
}

/**
 * Score a whole batch by micro-averaging (AC-6…AC-12).
 *
 * The three ratios are computed once over summed numerators and denominators.
 * A batch of zero cases returns three unknowns and is not an error.
 */
export function scoreEvalBatch(cases: EvalCaseResult[]): EvalBatchScore {
  const per_case: EvalCaseScore[] = [];

  let expectedMatched = 0;
  let expectedTotal = 0;
  let actualMatched = 0;
  let actualTotal = 0;
  let kept = 0;
  let citationTotal = 0;
  let passed = 0;

  for (const c of cases) {
    const score = scoreEvalCase(c);
    per_case.push(score);

    expectedMatched += score.expected_matched;
    expectedTotal += score.expected_total;
    actualMatched += score.actual_matched;
    actualTotal += score.actual_total;
    kept += score.grounded_kept;
    citationTotal += score.grounded_kept + score.grounded_dropped;
    if (score.pass) passed++;
  }

  return {
    recall: ratio(expectedMatched, expectedTotal),
    precision: ratio(actualMatched, actualTotal),
    citation_accuracy: ratio(kept, citationTotal),
    cases_total: cases.length,
    cases_passed: passed,
    per_case,
  };
}

/** `null` — unknown — whenever the denominator is zero. Not 0. Not 1. (AC-10…AC-12) */
function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

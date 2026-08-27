/**
 * The mechanical eval scorer — SPEC-08, AC-1…AC-14.
 *
 * Every test here is written against a criterion, not against the code: the
 * fixtures state what the spec says must happen and the assertions name the
 * wrong answers by hand where the spec does. Two families carry more weight
 * than the rest and are worth knowing about before editing anything below.
 *
 *  - **AC-3 is differential.** The scorer deliberately does NOT call
 *    `rangeIntersects`; it answers the contiguous-overlap question with
 *    arithmetic, because expanding a contiguous range into a `Set` allocates one
 *    entry per line of a model-supplied range that has no upper bound in the
 *    contract. AC-3 demands the same VERDICT as grounding, not the same code, so
 *    the proof is a table driven through both paths with the verdicts compared.
 *    Delete that test and `rangeIntersects`'s export becomes genuinely dead.
 *  - **`0/0` is `null`, a third value.** AC-10…AC-12. `0` and `1` are the two
 *    answers a future refactor produces, so both are asserted against by name:
 *    "0 of 0 expected findings = 100% recall" is the failure this spec exists to
 *    prevent — a set that measures nothing looking perfect precisely because it
 *    measures nothing.
 */
import { describe, it, expect } from 'vitest';
import type { Finding, FindingKind, LLMProvider } from '@devdigest/shared';
import {
  rangeIntersects,
  scoreEvalBatch,
  scoreEvalCase,
  type EvalCaseResult,
  type EvalExpectedFinding,
} from '../src/index.js';

let seq = 0;

/** A finding that survived grounding — `ReviewOutcome.review.findings[n]`. */
function actual(
  file: string,
  start: number,
  end: number,
  over: Partial<Finding> = {},
): Finding {
  seq += 1;
  return {
    id: `f${seq}`,
    severity: 'WARNING',
    category: 'bug',
    title: 'a finding',
    file,
    start_line: start,
    end_line: end,
    rationale: 'because',
    confidence: 0.8,
    kind: 'finding',
    ...over,
  };
}

/** One entry of a case's `expected_output`. */
function want(
  file: string,
  start: number,
  end: number,
  kind?: FindingKind,
): EvalExpectedFinding {
  return { file, start_line: start, end_line: end, ...(kind ? { kind } : {}) };
}

function mustFind(
  expected: EvalExpectedFinding[],
  actuals: Finding[],
  dropped = 0,
): EvalCaseResult {
  return { expectation: 'must_find', expected, actual: actuals, dropped };
}

function mustNotFlag(actuals: Finding[], dropped = 0, expected: EvalExpectedFinding[] = []): EvalCaseResult {
  return { expectation: 'must_not_flag', expected, actual: actuals, dropped };
}

// ---------------------------------------------------------------- Matching --

describe('matching (AC-1, AC-2)', () => {
  it('AC-1 — matches on an identical path and overlapping lines', () => {
    const score = scoreEvalCase(mustFind([want('src/a.ts', 10, 20)], [actual('src/a.ts', 18, 25)]));
    expect(score.expected_matched).toBe(1);
    expect(score.pass).toBe(true);
  });

  it('AC-1 — compares the path character-for-character, so src/A.ts is not src/a.ts', () => {
    // Regression this catches: someone "helpfully" normalising or case-folding
    // the path, which would silently score a case against the wrong file on any
    // case-insensitive filesystem.
    const score = scoreEvalCase(mustFind([want('src/A.ts', 10, 20)], [actual('src/a.ts', 10, 20)]));
    expect(score.expected_matched).toBe(0);
    expect(score.pass).toBe(false);
  });

  it('AC-1 — a matching path with disjoint lines is not a match', () => {
    const score = scoreEvalCase(mustFind([want('src/a.ts', 10, 20)], [actual('src/a.ts', 21, 30)]));
    expect(score.expected_matched).toBe(0);
  });

  it('AC-2 — one actual finding closes at most one of two overlapping expectations', () => {
    // Both expectations cover line 15. A matcher without a consumed-set would
    // close both with the single finding and report a perfect case.
    const score = scoreEvalCase(
      mustFind([want('src/a.ts', 10, 20), want('src/a.ts', 15, 25)], [actual('src/a.ts', 15, 15)]),
    );
    expect(score.expected_matched).toBe(1);
    expect(score.expected_total).toBe(2);
    expect(score.recall).toBe(0.5);
    expect(score.pass).toBe(false);
  });

  it('AC-2 — two actual findings close two overlapping expectations, one each', () => {
    const score = scoreEvalCase(
      mustFind(
        [want('src/a.ts', 10, 20), want('src/a.ts', 15, 25)],
        [actual('src/a.ts', 15, 15), actual('src/a.ts', 16, 16)],
      ),
    );
    expect(score.expected_matched).toBe(2);
    expect(score.actual_matched).toBe(2);
    expect(score.pass).toBe(true);
  });

  it('a full-file kind matches on the path alone, exactly as grounding admits it', () => {
    // grounding.ts:16 admits secret_leak/lethal_trifecta/phantom/hook on the file
    // being present at all. The scorer mirrors that: a secret expected anywhere in
    // the file matches a secret reported on any line of it.
    const score = scoreEvalCase(
      mustFind([want('src/a.ts', 1, 1, 'secret_leak')], [actual('src/a.ts', 900, 901, { kind: 'secret_leak' })]),
    );
    expect(score.expected_matched).toBe(1);

    // …and still not across files.
    const otherFile = scoreEvalCase(
      mustFind([want('src/a.ts', 1, 1, 'secret_leak')], [actual('src/b.ts', 1, 1, { kind: 'secret_leak' })]),
    );
    expect(otherFile.expected_matched).toBe(0);
  });
});

// ------------------------------------------------- AC-3: the differential ---

/**
 * AC-3 — "the same overlap verdict as grounding, on the same input ranges".
 *
 * Grounding's primitive answers "does [start,end] touch any of these SPARSE
 * lines?"; the scorer answers "do these two CONTIGUOUS ranges overlap?". Feeding
 * grounding the expected range expanded into its line set makes the two
 * questions the same question, and the verdicts must agree on every row.
 */
const RANGE_PAIRS: { name: string; expected: [number, number]; actualRange: [number, number] }[] = [
  { name: 'identical ranges', expected: [10, 20], actualRange: [10, 20] },
  { name: 'actual fully nested inside expected', expected: [10, 20], actualRange: [13, 15] },
  { name: 'expected fully nested inside actual', expected: [13, 15], actualRange: [10, 20] },
  { name: 'touching at one line — actual starts on expected end', expected: [10, 20], actualRange: [20, 30] },
  { name: 'touching at one line — actual ends on expected start', expected: [10, 20], actualRange: [1, 10] },
  { name: 'adjacent but disjoint — one line below', expected: [10, 20], actualRange: [1, 9] },
  { name: 'adjacent but disjoint — one line above', expected: [10, 20], actualRange: [21, 30] },
  { name: 'far disjoint', expected: [10, 20], actualRange: [100, 200] },
  { name: 'reversed expected range, overlapping', expected: [20, 10], actualRange: [15, 15] },
  { name: 'reversed actual range, overlapping', expected: [10, 20], actualRange: [25, 15] },
  { name: 'both ranges reversed, disjoint', expected: [20, 10], actualRange: [40, 30] },
  { name: 'single line each, equal', expected: [7, 7], actualRange: [7, 7] },
  { name: 'single line each, off by one', expected: [7, 7], actualRange: [8, 8] },
  { name: 'partial overlap from the left', expected: [10, 20], actualRange: [5, 12] },
  { name: 'partial overlap from the right', expected: [10, 20], actualRange: [18, 40] },
];

/** The expected range as grounding would see it: a set of new-side line numbers. */
function asLineSet([start, end]: [number, number]): Set<number> {
  const lines = new Set<number>();
  for (let n = Math.min(start, end); n <= Math.max(start, end); n++) lines.add(n);
  return lines;
}

/** The scorer's verdict, reached only through its public API. */
function scorerVerdict(expected: [number, number], actualRange: [number, number]): boolean {
  const score = scoreEvalCase(
    mustFind(
      [want('src/x.ts', expected[0], expected[1])],
      [actual('src/x.ts', actualRange[0], actualRange[1])],
    ),
  );
  return score.expected_matched === 1;
}

describe('AC-3 — the scorer and grounding agree on every range pair', () => {
  it.each(RANGE_PAIRS)('$name', ({ expected, actualRange }) => {
    const grounding = rangeIntersects(asLineSet(expected), actualRange[0], actualRange[1]);
    expect(scorerVerdict(expected, actualRange)).toBe(grounding);
  });

  it('the table is not degenerate — it contains both verdicts, and a true one with differing starts', () => {
    // Without this, a table of all-false rows (or all-true) would "agree" while
    // proving nothing, and a matcher as naive as `start === start` would pass.
    const verdicts = RANGE_PAIRS.map((p) => rangeIntersects(asLineSet(p.expected), p.actualRange[0], p.actualRange[1]));
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);

    const overlappingWithDifferentStarts = RANGE_PAIRS.filter(
      (p, i) => verdicts[i] === true && p.expected[0] !== p.actualRange[0],
    );
    expect(overlappingWithDifferentStarts.length).toBeGreaterThan(0);
  });

  it('a huge contiguous range is decided by arithmetic, not by materialising it', () => {
    // The regression: an implementation that expands the expected range into a
    // Set and loops over the actual range. `start_line`/`end_line` are
    // `z.number().int()` with no upper bound and arrive from a fresh model
    // response, so 1–10_000_000 vs 10_000_001–999_999_999 was an unbounded
    // allocation followed by an ~1e9-iteration loop that never returns early.
    // The DISJOINT case is the worse one — the overlapping case exits on its
    // first hit even in the old shape.
    //
    // `rangeIntersects` is deliberately NOT driven here: it is the primitive
    // whose cost this test exists to keep out of the scorer.
    const started = performance.now();

    const overlapping = scoreEvalCase(
      mustFind([want('src/big.ts', 1, 10_000_000)], [actual('src/big.ts', 9_999_999, 999_999_999)]),
    );
    const disjoint = scoreEvalCase(
      mustFind([want('src/big.ts', 1, 10_000_000)], [actual('src/big.ts', 10_000_001, 999_999_999)]),
    );

    const elapsedMs = performance.now() - started;

    expect(overlapping.expected_matched).toBe(1);
    expect(disjoint.expected_matched).toBe(0);
    // Four comparisons cost microseconds; the Set shape costs seconds and
    // hundreds of megabytes. The budget is deliberately enormous so that a busy
    // CI runner cannot make this flaky while it still catches the regression.
    expect(elapsedMs).toBeLessThan(500);
  });
});

// -------------------------------------------------- Per-case verdict AC-4/5 --

describe('per-case verdict (AC-4, AC-5)', () => {
  it('AC-4 — must_find passes only when EVERY expected finding is matched', () => {
    const both = scoreEvalCase(
      mustFind(
        [want('src/a.ts', 10, 12), want('src/b.ts', 30, 31)],
        [actual('src/a.ts', 11, 11), actual('src/b.ts', 31, 31)],
      ),
    );
    expect(both.pass).toBe(true);

    const oneOfTwo = scoreEvalCase(
      mustFind([want('src/a.ts', 10, 12), want('src/b.ts', 30, 31)], [actual('src/a.ts', 11, 11)]),
    );
    expect(oneOfTwo.pass).toBe(false);
    expect(oneOfTwo.recall).toBe(0.5);
  });

  it('AC-5 — must_not_flag passes only when nothing survived grounding', () => {
    expect(scoreEvalCase(mustNotFlag([])).pass).toBe(true);
    expect(scoreEvalCase(mustNotFlag([actual('src/a.ts', 1, 1)])).pass).toBe(false);
  });

  it('AC-5 — a must_not_flag case still passes when grounding dropped findings', () => {
    // Dropped findings never reached the reviewer's output, so they cannot fail
    // the case; they only move citation accuracy.
    const score = scoreEvalCase(mustNotFlag([], 3));
    expect(score.pass).toBe(true);
    expect(score.citation_accuracy).toBe(0);
  });
});

// ------------------------------------------------------- Batch metrics AC-6+ --

describe('batch metrics — micro-averaged, not a mean of per-case metrics (AC-6…AC-9)', () => {
  /**
   * Case A expects five findings and gets one right, while emitting four
   * findings that match nothing. Case B expects one and gets it. Micro and macro
   * disagree by construction, which is the whole point of AC-6.
   */
  function skewedBatch(): EvalCaseResult[] {
    const caseA = mustFind(
      [
        want('src/a.ts', 10, 11),
        want('src/a.ts', 20, 21),
        want('src/a.ts', 30, 31),
        want('src/a.ts', 40, 41),
        want('src/a.ts', 50, 51),
      ],
      [
        actual('src/a.ts', 10, 10),
        actual('src/a.ts', 100, 100),
        actual('src/a.ts', 101, 101),
        actual('src/a.ts', 102, 102),
        actual('src/a.ts', 103, 103),
      ],
    );
    const caseB = mustFind([want('src/b.ts', 5, 6)], [actual('src/b.ts', 6, 7)]);
    return [caseA, caseB];
  }

  it('AC-6 — the five-expectation case outweighs the one-expectation case, and micro ≠ macro', () => {
    const batch = scoreEvalBatch(skewedBatch());

    // Per-case recalls stated by hand so the macro figure below cannot drift
    // with the implementation.
    expect(batch.per_case.map((c) => c.recall)).toEqual([0.2, 1]);
    const macroRecall = (0.2 + 1) / 2; // 0.6

    expect(batch.recall).toBe(2 / 6); // Σ matched 2 over Σ expected 6
    expect(batch.recall).not.toBe(macroRecall);
  });

  it('AC-7 — precision is micro-averaged the same way, and differs from its macro average', () => {
    const batch = scoreEvalBatch(skewedBatch());

    expect(batch.per_case.map((c) => c.precision)).toEqual([0.2, 1]);
    const macroPrecision = (0.2 + 1) / 2;

    expect(batch.precision).toBe(2 / 6);
    expect(batch.precision).not.toBe(macroPrecision);
  });

  it('AC-8 / AC-9 — must_not_flag adds nothing to the recall denominator and everything to precision’s', () => {
    const positive = mustFind([want('src/b.ts', 5, 6)], [actual('src/b.ts', 6, 6)]);
    // The hostile shape: a negative case carrying expectations that WOULD match.
    // AC-9 says none of its findings is ever matched — all three are false
    // positives by construction.
    const negative = mustNotFlag(
      [actual('src/c.ts', 1, 1), actual('src/c.ts', 2, 2), actual('src/c.ts', 3, 3)],
      0,
      [want('src/c.ts', 1, 3)],
    );

    const withoutNegative = scoreEvalBatch([positive]);
    const withNegative = scoreEvalBatch([positive, negative]);

    // AC-8: recall is untouched — same numerator, same denominator.
    expect(withoutNegative.recall).toBe(1);
    expect(withNegative.recall).toBe(1);
    expect(withNegative.per_case[1]!.expected_total).toBe(0);

    // AC-9: three findings into the precision denominator, zero into the numerator.
    expect(withoutNegative.precision).toBe(1);
    expect(withNegative.precision).toBe(1 / 4);
    expect(withNegative.per_case[1]!.actual_matched).toBe(0);
  });

  it('counts passes separately from the metrics', () => {
    const batch = scoreEvalBatch([
      mustFind([want('src/a.ts', 1, 2)], [actual('src/a.ts', 1, 1)]),
      mustFind([want('src/a.ts', 1, 2)], []),
      mustNotFlag([]),
    ]);
    expect(batch.cases_total).toBe(3);
    expect(batch.cases_passed).toBe(2);
  });

  it('citation accuracy is kept / (kept + dropped), summed across the batch (AC-12 denominator)', () => {
    const batch = scoreEvalBatch([
      mustFind([want('src/a.ts', 1, 2)], [actual('src/a.ts', 1, 1)], 1),
      mustNotFlag([actual('src/b.ts', 9, 9)], 1),
    ]);
    expect(batch.citation_accuracy).toBe(2 / 4);
  });

  it('scores a 20 × 20 × 20 batch to the exact micro-averages (NFR-2 fixture)', () => {
    // Correctness at the size NFR-2 measures. Half of each case's expectations
    // are hit and half of each case's findings match nothing, so the arithmetic
    // is checkable by hand: 200/400 recall, 200/400 precision, 400/500 citation.
    const cases: EvalCaseResult[] = [];
    for (let c = 0; c < 20; c++) {
      const file = `src/f${c}.ts`;
      const expectations: EvalExpectedFinding[] = [];
      const actuals: Finding[] = [];
      for (let i = 0; i < 20; i++) expectations.push(want(file, 10 * i + 1, 10 * i + 2));
      for (let i = 0; i < 10; i++) actuals.push(actual(file, 10 * i + 1, 10 * i + 1));
      for (let i = 0; i < 10; i++) actuals.push(actual(file, 9000 + i, 9000 + i));
      cases.push(mustFind(expectations, actuals, 5));
    }

    const batch = scoreEvalBatch(cases);
    expect(batch.recall).toBe(200 / 400);
    expect(batch.precision).toBe(200 / 400);
    expect(batch.citation_accuracy).toBe(400 / 500);
    expect(batch.cases_passed).toBe(0);
  });
});

// ------------------------------------------------------------ 0/0 → unknown --

describe('a zero denominator is unknown — a third value beside 0 and 1 (AC-10…AC-12)', () => {
  it('AC-10 — a batch of only must_not_flag cases has recall null, forever, by design', () => {
    const batch = scoreEvalBatch([
      mustNotFlag([]),
      mustNotFlag([actual('src/a.ts', 1, 1)]),
    ]);
    expect(batch.recall).toBeNull();
    // The two wrong answers, named by hand: "0 of 0 = 100%" is the failure this
    // spec is written against, and 0 would read as "the agent missed everything".
    expect(batch.recall).not.toBe(1);
    expect(batch.recall).not.toBe(0);
  });

  it('AC-11 — a batch where the agent said nothing has precision null, not a perfect 1', () => {
    const batch = scoreEvalBatch([mustFind([want('src/a.ts', 1, 2)], [])]);
    expect(batch.precision).toBeNull();
    expect(batch.precision).not.toBe(1);
    expect(batch.precision).not.toBe(0);
    // …while recall is a real 0: an expectation existed and was not met.
    expect(batch.recall).toBe(0);
  });

  it('AC-12 — no findings kept and none dropped leaves citation accuracy unknown', () => {
    const batch = scoreEvalBatch([mustFind([want('src/a.ts', 1, 2)], [], 0)]);
    expect(batch.citation_accuracy).toBeNull();
    expect(batch.citation_accuracy).not.toBe(1);
    expect(batch.citation_accuracy).not.toBe(0);
  });

  it('an empty batch is three unknowns and not an error', () => {
    const batch = scoreEvalBatch([]);
    expect(batch.recall).toBeNull();
    expect(batch.precision).toBeNull();
    expect(batch.citation_accuracy).toBeNull();
    expect(batch.cases_total).toBe(0);
    expect(batch.per_case).toEqual([]);
  });

  it('the unknowns are per-metric, not per-batch — one can be null while another is a number', () => {
    // Regression: a single "everything unknown" short-circuit. Here recall is
    // unknown (no expectations) while precision is a real 0 (two findings, none
    // matchable) and citation accuracy is a real 1.
    const batch = scoreEvalBatch([mustNotFlag([actual('src/a.ts', 1, 1), actual('src/a.ts', 2, 2)], 0)]);
    expect(batch.recall).toBeNull();
    expect(batch.precision).toBe(0);
    expect(batch.citation_accuracy).toBe(1);
  });
});

// -------------------------------------------------------- Purity AC-13/14 ---

/** An LLM provider whose every method is a trap. Absence, not thrift (AC-13). */
class ExplodingLLMProvider implements LLMProvider {
  readonly id = 'openai' as const;
  calls = 0;

  private boom(method: string): never {
    this.calls += 1;
    throw new Error(`AC-13 violated: the scorer reached the model through ${method}()`);
  }

  listModels(): never {
    return this.boom('listModels');
  }
  complete(): never {
    return this.boom('complete');
  }
  completeStructured(): never {
    return this.boom('completeStructured');
  }
  embed(): never {
    return this.boom('embed');
  }
}

describe('purity (AC-13, AC-14)', () => {
  it('AC-13 — scores a whole batch in an environment where any model call throws', () => {
    const llm = new ExplodingLLMProvider();
    const realFetch = globalThis.fetch;
    // The network is a trap too: a scorer that "just" enriched a finding over
    // HTTP would be caught here rather than in production.
    globalThis.fetch = (() => {
      throw new Error('AC-13 violated: the scorer used the network');
    }) as typeof globalThis.fetch;

    try {
      const batch = scoreEvalBatch([
        mustFind([want('src/a.ts', 10, 11)], [actual('src/a.ts', 10, 10)], 1),
        mustNotFlag([actual('src/b.ts', 3, 3)]),
      ]);
      expect(batch.recall).toBe(1);
      expect(batch.precision).toBe(0.5);
      expect(batch.cases_passed).toBe(1);
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(llm.calls).toBe(0);
  });

  it('AC-14 — two calls with the same arguments return deeply equal results', () => {
    const cases = [
      mustFind([want('src/a.ts', 10, 11), want('src/a.ts', 20, 21)], [actual('src/a.ts', 10, 10)], 2),
      mustNotFlag([actual('src/b.ts', 1, 1)], 1),
      mustFind([want('src/c.ts', 1, 1, 'secret_leak')], [actual('src/c.ts', 80, 80, { kind: 'secret_leak' })]),
    ];
    const first = scoreEvalBatch(cases);
    const second = scoreEvalBatch(cases);
    expect(second).toEqual(first);
  });
});

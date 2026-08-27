import { describe, it, expect } from 'vitest';
import {
  evalCaseName,
  expectationForFinding,
  expectedOutputFor,
  parseExpectedOutput,
  toFileDiff,
} from '../src/modules/evals/helpers.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { diffFromPrFiles } from '../src/modules/reviews/diff-loader.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import type * as t from '../src/db/schema.js';

/**
 * L06 / SPEC-08 — turning a DECIDED finding into an eval case, hermetically.
 *
 * Everything here is a pure function of its arguments, so none of it needs a
 * database (`onion-architecture` §12, ring 0/1). The database half — that these
 * values survive an insert and come back through the route — is
 * `evals-create.it.test.ts`; nothing is asserted twice.
 *
 * NO DOCKER. This file is one of the hermetic lanes.
 */

const ACCEPTED = new Date('2026-08-21T10:20:00.000Z');
const DISMISSED = new Date('2026-08-21T10:24:00.000Z');

/** The fields `expectedOutputFor` / `evalCaseName` actually read. */
const FINDING = {
  file: 'src/middleware/ratelimit.ts',
  startLine: 10,
  endLine: 12,
  kind: 'finding',
  title: 'Rate-limit key trusts a client-supplied header',
};

describe('expectationForFinding — the decision IS the direction', () => {
  it('maps an accepted finding to must_find (AC-15)', () => {
    expect(expectationForFinding({ acceptedAt: ACCEPTED, dismissedAt: null })).toBe('must_find');
  });

  it('maps a dismissed finding to must_not_flag (AC-16)', () => {
    expect(expectationForFinding({ acceptedAt: null, dismissedAt: DISMISSED })).toBe(
      'must_not_flag',
    );
  });

  it('returns null for an undecided finding, so the caller can 422 (AC-17)', () => {
    // Not `'must_find'` as a "safe default": a case seeded from a finding nobody
    // decided asserts an expectation nobody holds, and it would score forever.
    expect(expectationForFinding({ acceptedAt: null, dismissedAt: null })).toBeNull();
  });

  it('prefers accepted when a row somehow carries both timestamps', () => {
    expect(expectationForFinding({ acceptedAt: ACCEPTED, dismissedAt: DISMISSED })).toBe(
      'must_find',
    );
  });
});

describe('expectedOutputFor — what the case asserts', () => {
  it('records EXACTLY ONE finding carrying the source path and range verbatim (AC-20)', () => {
    const expected = expectedOutputFor('must_find', FINDING);

    // Value equality on the whole array, not `toContainEqual`: an extra
    // expectation would make `recall` unreachable, and a "tidied" path (leading
    // `./`, a normalised separator) makes the case unmatchable, because the
    // scorer compares paths character-for-character.
    expect(expected).toEqual([
      {
        file: 'src/middleware/ratelimit.ts',
        start_line: 10,
        end_line: 12,
        kind: 'finding',
      },
    ]);
  });

  it('records an EMPTY ARRAY for must_not_flag — not null (AC-21)', () => {
    const expected = expectedOutputFor('must_not_flag', FINDING);

    expect(expected).toEqual([]);
    // Named by hand because the two are a different claim: `null` reads as "no
    // expectation was recorded", `[]` reads as "this case expects nothing to be
    // reported", and only the second is scoreable.
    expect(expected).not.toBeNull();
  });
});

describe('parseExpectedOutput — reading a persisted expectation back', () => {
  it('round-trips what expectedOutputFor wrote', () => {
    expect(parseExpectedOutput(expectedOutputFor('must_find', FINDING))).toEqual(
      expectedOutputFor('must_find', FINDING),
    );
  });

  it('drops entries that cannot be scored instead of admitting a half-shaped one', () => {
    // `expected_output` is `jsonb` — nothing in the database constrains its
    // shape, so a row hand-edited or written by an older version reaches the
    // scorer. An entry with a missing `start_line` would compare `undefined`
    // against a real line number and silently never match.
    const parsed = parseExpectedOutput([
      { file: 'a.ts', start_line: 1, end_line: 2, kind: 'finding' },
      { file: 'b.ts', start_line: '3', end_line: 4 },
      { file: 'c.ts', end_line: 4 },
      null,
      'nope',
    ]);

    expect(parsed).toEqual([{ file: 'a.ts', start_line: 1, end_line: 2, kind: 'finding' }]);
  });

  it('returns [] for a non-array, never undefined', () => {
    expect(parseExpectedOutput(null)).toEqual([]);
    expect(parseExpectedOutput({ file: 'a.ts' })).toEqual([]);
  });
});

describe('toFileDiff — the stored diff is ONE file (AC-19)', () => {
  // GitHub's per-file `patch` is hunk text only. This is the shape every seeded
  // and imported row carries.
  const PATCH = ['@@ -0,0 +1,3 @@', '+const a = 1;', '+const b = 2;', '+const c = 3;'].join('\n');

  it('adds the header a unified-diff parser needs, and nothing else', () => {
    const diff = parseUnifiedDiff(toFileDiff('src/middleware/ratelimit.ts', PATCH));

    // The regression: without the `diff --git` / `---` / `+++` header the parse
    // yields ZERO files, every case in every batch is recorded `errored`, and
    // the reason has nothing to do with the agent under test.
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]!.path).toBe('src/middleware/ratelimit.ts');

    // The three added lines are covered, and NOTHING ELSE. This assertion was
    // written as `[1, 2, 3, 4]` to pin observed-but-wrong behaviour: `toFileDiff`
    // terminated the diff with a newline, `parseUnifiedDiff` read the resulting
    // empty final line as one more context line, and grounding therefore admitted
    // a citation one line past the end of every case's last hunk. That made
    // `citation_accuracy` — a graded metric — silently lenient on every case in
    // every batch, and lenient in one direction only: the PR-review path's
    // `diffFromPrFiles` appends no terminator, so the harness was grading more
    // generously than the reviewer it measures. `toFileDiff` now strips trailing
    // newlines and matches that function's output shape. Kept as an exact-value
    // assertion, never a range — a range is what let the fourth line hide.
    expect(diff.files[0]!.hunks[0]!.newLineNumbers).toEqual([1, 2, 3]);
  });

  it('carries only the finding’s OWN file, so a case cannot be scored against a neighbour', () => {
    const diff = parseUnifiedDiff(toFileDiff('src/config.ts', PATCH));
    expect(diff.files.map((f) => f.path)).toEqual(['src/config.ts']);
  });

  it('passes a patch that ALREADY has a header through without double-wrapping', () => {
    const full = [
      'diff --git a/src/config.ts b/src/config.ts',
      '--- a/src/config.ts',
      '+++ b/src/config.ts',
      PATCH,
    ].join('\n');

    const wrapped = toFileDiff('src/config.ts', full);

    // A second header would give the parser two file records for one file: the
    // first empty, and grounding then measures against the wrong one.
    expect(wrapped.match(/diff --git /g)).toHaveLength(1);
    expect(parseUnifiedDiff(wrapped).files).toHaveLength(1);
  });

  it('does not grow a blank line each time it is applied', () => {
    // `patch` may or may not end with a newline depending on the importer; the
    // header path must not turn that into a trailing empty hunk line.
    expect(toFileDiff('a.ts', `${PATCH}\n`)).toBe(toFileDiff('a.ts', PATCH));
  });
});

/**
 * The eval path and the PR-review path must reassemble a stored patch the SAME
 * way, and nothing else asserts that.
 *
 * `toFileDiff` (the eval harness) and `diffFromPrFiles`
 * (`modules/reviews/diff-loader.ts:47-58`, the normal review path) both turn
 * `pr_files.patch` text into a parseable unified diff, from the same two inputs:
 * a path and a patch. They are separate implementations, and the harness exists
 * to MEASURE the reviewer — so any disagreement between them is the harness
 * grading a different artefact from the one that ships.
 *
 * That is not hypothetical. `toFileDiff` terminated its output with a newline
 * until 2026-08-27; `parseUnifiedDiff` counted the resulting empty final element
 * as a context line; and grounding therefore admitted a citation one line past
 * the end of every case's last hunk. The harness was strictly more lenient than
 * the reviewer, on every case in every batch, and the only reason it surfaced is
 * that one exact-value assertion happened to enumerate the covered lines.
 *
 * The fix restored parity — but it pinned only ONE side. If `diffFromPrFiles`
 * later gains a terminator, the same divergence reopens in the same direction
 * with nothing going red. This block pins the AGREEMENT rather than either
 * side's output: the emitted text and the `newLineNumbers` the parser derives
 * from it, both ends, so a change to either surfaces as a failure instead of as
 * quiet leniency. Same shape as the AC-3 differential in `reviewer-core`
 * (scorer arithmetic against `rangeIntersects`).
 */
describe('toFileDiff ↔ diffFromPrFiles parity', () => {
  const PR_ID = 'pr-differential';

  /**
   * `diffFromPrFiles` reads exactly one method off the repository, so the double
   * is that method and a cast at the boundary — the same shape
   * `smart-diff-service.test.ts:138` uses. The ROWS are typed off the schema
   * rather than declared loosely, so a column change breaks this at compile time.
   */
  function repoWith(files: { path: string; patch: string | null }[]): ReviewRepository {
    const rows: (typeof t.prFiles.$inferSelect)[] = files.map((f, i) => ({
      id: `file-${i}`,
      prId: PR_ID,
      path: f.path,
      additions: 0,
      deletions: 0,
      patch: f.patch,
    }));
    return { getPrFiles: async () => rows } as unknown as ReviewRepository;
  }

  /** The same path + patch through both reassemblers. */
  async function bothWays(path: string, patch: string) {
    return {
      viaEval: parseUnifiedDiff(toFileDiff(path, patch)),
      viaReview: await diffFromPrFiles(repoWith([{ path, patch }]), PR_ID),
    };
  }

  const lineNumbers = (diff: Awaited<ReturnType<typeof bothWays>>['viaEval']) =>
    diff.files.map((f) => ({ path: f.path, lines: f.hunks.map((h) => h.newLineNumbers) }));

  /**
   * GitHub-shaped patches — hunk text, no header, no terminator. This is what
   * `pr_files.patch` actually stores, for both the seed and a real import.
   */
  const FIXTURES: { name: string; path: string; patch: string }[] = [
    {
      name: 'a new file, one hunk of pure additions',
      path: 'src/middleware/ratelimit.ts',
      patch: ['@@ -0,0 +1,3 @@', '+const a = 1;', '+const b = 2;', '+const c = 3;'].join('\n'),
    },
    {
      name: 'an edit with context and a deletion',
      path: 'src/config.ts',
      patch: [
        '@@ -10,4 +10,5 @@ export const config = {',
        '   port: 3000,',
        '-  legacyKey: null,',
        '+  stripeKey: "sk_live_xxx",',
        '+  redisUrl: process.env.REDIS_URL,',
        '   timeout: 30,',
      ].join('\n'),
    },
    {
      name: 'two hunks in one patch',
      path: 'src/routes/webhooks.ts',
      patch: [
        '@@ -1,3 +1,4 @@',
        ' import type { FastifyInstance } from "fastify";',
        '+import { verifySignature } from "../crypto.js";',
        ' ',
        ' export function register(app: FastifyInstance): void {',
        '@@ -33,6 +34,9 @@ export function register(app: FastifyInstance): void {',
        '     const raw = req.rawBody;',
        '+    if (provider !== "legacy" && !verifySignature(provider, raw)) {',
        '+      return reply.code(401).send();',
        '+    }',
        '     return reply.code(202).send();',
      ].join('\n'),
    },
    {
      name: 'a hunk whose last line is CONTEXT, not an addition',
      path: 'src/db.ts',
      patch: ['@@ -5,3 +5,4 @@', '+const added = 1;', ' const kept = 2;', ' const alsoKept = 3;'].join(
        '\n',
      ),
    },
  ];

  for (const fixture of FIXTURES) {
    it(`emits byte-identical diff text for ${fixture.name}`, async () => {
      const { viaEval, viaReview } = await bothWays(fixture.path, fixture.patch);

      // `UnifiedDiff.raw` is the exact string each side handed the parser, so
      // this compares the emitted TEXT and not merely what survived parsing.
      expect(viaEval.raw).toBe(viaReview.raw);
    });

    it(`derives identical covered lines for ${fixture.name}`, async () => {
      const { viaEval, viaReview } = await bothWays(fixture.path, fixture.patch);

      // The end that actually decides a metric: `newLineNumbers` is what
      // `groundFindings` intersects a citation against, so a divergence here is
      // a divergence in `citation_accuracy`. Asserted as full value equality,
      // never a length or a superset — a superset is what the phantom line was.
      expect(lineNumbers(viaEval)).toEqual(lineNumbers(viaReview));
      expect(viaEval.files).toEqual(viaReview.files);
    });
  }

  it('agrees on every fixture at once, so one passing case cannot carry the rest', async () => {
    const mismatches: string[] = [];
    for (const fixture of FIXTURES) {
      const { viaEval, viaReview } = await bothWays(fixture.path, fixture.patch);
      if (viaEval.raw !== viaReview.raw) {
        mismatches.push(`${fixture.name}: ${JSON.stringify(viaEval.raw)} vs ${JSON.stringify(viaReview.raw)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('DIVERGES today when the STORED patch itself carries a trailing newline', async () => {
    // Measured on 2026-08-27, recorded rather than endorsed, and NOT repaired
    // here — the defect is in production code this file may not touch.
    //
    // `toFileDiff` now strips trailing newlines from the patch it is given.
    // `diffFromPrFiles` does not: it pushes `f.patch` verbatim as the last
    // element of a `join('\n')`, so a stored terminator survives into the text
    // the parser sees, and `parseUnifiedDiff` counts the empty final element as
    // one more covered line. The phantom line was not eliminated — it MOVED,
    // from the eval harness to the PR-review path, and it now points the other
    // way: grounding on a real review would admit a citation one line past the
    // last hunk while the harness measuring that reviewer would not.
    //
    // Latent, not active: every patch in `db/seed.ts` is `.trim()`ed and
    // GitHub's per-file `patch` carries no terminator, so no current input hits
    // it. An importer that stores one would, silently.
    //
    // Owner: `modules/reviews/diff-loader.ts:47-58` (or `parseUnifiedDiff`,
    // which is the deeper fix — an empty trailing element is not a context
    // line). Pinned by exact value on BOTH sides so that fixing either one is a
    // visible failure here rather than a quiet change of meaning.
    const stored = `${FIXTURES[0]!.patch}\n`;
    const viaEval = parseUnifiedDiff(toFileDiff(FIXTURES[0]!.path, stored));
    const viaReview = await diffFromPrFiles(repoWith([{ path: FIXTURES[0]!.path, patch: stored }]), PR_ID);

    expect(viaEval.files[0]!.hunks[0]!.newLineNumbers).toEqual([1, 2, 3]);
    expect(viaReview.files[0]!.hunks[0]!.newLineNumbers).toEqual([1, 2, 3, 4]);
    // The parity this block asserts everywhere else does NOT hold here, and
    // saying so explicitly is the point: a later reader must not take the four
    // green fixtures above as "these two agree on all inputs".
    expect(viaEval.raw).not.toBe(viaReview.raw);
  });

  it('would go red if either side gained a trailing newline', async () => {
    // The control. This differential is only worth keeping if it can FAIL, and
    // the failure mode it guards is precisely "one side terminates its output
    // and the other does not". Simulating the pre-fix `toFileDiff` against the
    // unchanged review path must produce both symptoms: different text, and one
    // more covered line on the lenient side.
    const fixture = FIXTURES[0]!;
    const terminated = `${toFileDiff(fixture.path, fixture.patch)}\n`;
    const viaReview = await diffFromPrFiles(repoWith([fixture]), PR_ID);

    expect(parseUnifiedDiff(terminated).raw).not.toBe(viaReview.raw);
    expect(parseUnifiedDiff(terminated).files[0]!.hunks[0]!.newLineNumbers).toEqual([1, 2, 3, 4]);
    expect(viaReview.files[0]!.hunks[0]!.newLineNumbers).toEqual([1, 2, 3]);
  });
});

describe('evalCaseName', () => {
  it('names the case after the finding and the exact location it pins', () => {
    expect(evalCaseName(FINDING)).toBe(
      'Rate-limit key trusts a client-supplied header — src/middleware/ratelimit.ts:10-12',
    );
  });
});

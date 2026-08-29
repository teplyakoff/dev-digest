import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Finding } from '@devdigest/shared';
import { groundFindings, rangeIntersects } from '@devdigest/reviewer-core';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import { diffFromPrFiles } from '../src/modules/reviews/diff-loader.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[seed] Docker not available — skipping integration tests.');
}

/**
 * L06 / SPEC-08 — AC-30…AC-34: the seed is not vacuous.
 *
 * ## Why this file exists at all
 *
 * Root `INSIGHTS.md:435` records a graded eval case whose expected target path
 * was copied out of a documentation example. It matched nothing, scored a clean
 * green for weeks, and measured nothing the entire time. The same failure is
 * available here in a stronger form: seeded `pr_files` used to carry
 * `patch: null` (`server/INSIGHTS.md:66-72`), so `groundFindings` dropped 100%
 * of findings against the seeded PR — and a demo run against that data would
 * report zero findings, zero citation accuracy and no error.
 *
 * ## What that means for how this file is written
 *
 * The seed's fixture array is module-local and deliberately **not exported**.
 * Importing it and comparing it against itself would reproduce the vacuous
 * green exactly: a test that asserts a constant equals itself passes whatever
 * the seed writes. So EVERY value below is read back out of the database, and
 * the intersection is re-derived by running the production diff reconstruction
 * (`diffFromPrFiles`) and the production grounding gate (`groundFindings`) over
 * what the database actually contains.
 *
 * "The patch is non-empty" is likewise not enough on its own — it stays green on
 * exactly the data AC-31 exists to reject (real patch text paired with line
 * numbers taken from somewhere else). Hence the per-finding enumeration.
 *
 * FILE NAME IS LOAD-BEARING: `*.it.test.ts` is how the CI suite split finds the
 * Docker-requiring tests.
 */

/** Map a persisted findings row onto the engine's `Finding` shape. */
function toEngineFinding(row: typeof t.findings.$inferSelect): Finding {
  return {
    id: row.id,
    severity: row.severity as Finding['severity'],
    category: row.category as Finding['category'],
    title: row.title,
    file: row.file,
    start_line: row.startLine,
    end_line: row.endLine,
    rationale: row.rationale,
    confidence: row.confidence,
    kind: row.kind as Finding['kind'],
  };
}

d('pnpm db:seed — the demo data a review can actually be scored against', () => {
  let pg: PgFixture;
  let db: PgFixture['handle']['db'];
  let prId: string;
  let files: (typeof t.prFiles.$inferSelect)[];
  let findings: (typeof t.findings.$inferSelect)[];

  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;
    const { workspaceId } = await seed(db);

    const [repo] = await db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
    const [pr] = await db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repo!.id), eq(t.pullRequests.number, 482)));
    prId = pr!.id;

    files = await db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));

    // Findings reached through the review that owns them — the same join every
    // read path uses, so a finding hanging off nothing would be invisible here
    // exactly as it is invisible in the UI.
    const rows = await db
      .select({ finding: t.findings })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .where(eq(t.reviews.prId, prId));
    findings = rows.map((r) => r.finding);
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  });

  it('gives every seeded PR file non-empty patch text (AC-30)', () => {
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      // Enumerated per file rather than asserted over the collection: the
      // failure has to name WHICH file lost its patch, because the symptom
      // downstream — every finding on that file silently dropped — names
      // nothing at all.
      expect(file.patch, `pr_files row for ${file.path} has no patch`).not.toBeNull();
      expect((file.patch ?? '').trim().length, `patch for ${file.path} is empty`).toBeGreaterThan(0);
    }
  });

  it('anchors every seeded finding inside a hunk of its OWN file’s patch (AC-31)', async () => {
    // Rebuilt through the production path, from the rows in the database —
    // `diffFromPrFiles` is what an actual review against seeded data uses, so
    // this measures the same diff the agent would have been given.
    const diff = await diffFromPrFiles(new ReviewRepository(db), prId);
    expect(diff.files.length).toBe(files.length);

    const linesByPath = new Map<string, Set<number>>();
    for (const file of diff.files) {
      const covered = new Set<number>();
      for (const hunk of file.hunks) {
        for (const n of hunk.newLineNumbers ?? []) covered.add(n);
      }
      linesByPath.set(file.path, covered);
    }

    expect(findings.length).toBeGreaterThan(0);

    for (const finding of findings) {
      const where = `${finding.title} @ ${finding.file}:${finding.startLine}-${finding.endLine}`;

      const covered = linesByPath.get(finding.file);
      expect(covered, `${where} — its file is not in the reconstructed diff`).toBeDefined();

      // `rangeIntersects` is the very primitive `groundFindings` decides with,
      // so this cannot pass by using a laxer rule than production does.
      expect(
        rangeIntersects(covered!, finding.startLine, finding.endLine),
        `${where} — the range intersects no hunk of its own file`,
      ).toBe(true);
    }
  });

  it('keeps 100% of the seeded findings through the real grounding gate (AC-31)', async () => {
    const diff = await diffFromPrFiles(new ReviewRepository(db), prId);
    const result = groundFindings(findings.map(toEngineFinding), diff);

    // The whole-set restatement of the assertion above, run through the gate
    // itself rather than through its primitive. `dropped` is asserted by VALUE,
    // not by length, so a failure prints the finding and the reason instead of
    // "expected 1 to be 0".
    expect(result.dropped).toEqual([]);
    expect(result.kept).toHaveLength(findings.length);
  });

  it('would go red if a patch and its findings were authored apart', async () => {
    // The control for the assertion above: it must be capable of failing.
    // Shifting one finding 500 lines past its hunk — the exact shape of "the
    // range was copied from somewhere else" — has to be dropped by the same
    // gate that keeps all 12 unshifted.
    const diff = await diffFromPrFiles(new ReviewRepository(db), prId);
    const first = toEngineFinding(findings[0]!);
    const drifted: Finding = { ...first, start_line: first.start_line + 500, end_line: first.end_line + 500 };

    const result = groundFindings([drifted], diff);

    expect(result.kept).toEqual([]);
    expect(result.dropped).toHaveLength(1);
  });

  it('decides every seeded finding, at least eight of them (AC-32)', () => {
    const decided = findings.filter((f) => f.acceptedAt !== null || f.dismissedAt !== null);

    expect(decided.length).toBeGreaterThanOrEqual(8);
    // Stronger than the criterion and deliberately so: AC-35 needs at least
    // eight CASES to come out of this data through the real one-click path, and
    // an undecided finding is a 422 on that path rather than a case.
    expect(decided.length).toBe(findings.length);
  });

  it('carries both directions, so the case set is not all one-sided (AC-33, AC-34)', () => {
    const accepted = findings.filter((f) => f.acceptedAt !== null);
    const dismissed = findings.filter((f) => f.dismissedAt !== null);

    // Accepted → `must_find`, dismissed → `must_not_flag`. A set with only one
    // direction can never move `precision`, so an "improvement" would be
    // unfalsifiable by construction.
    expect(accepted.length).toBeGreaterThanOrEqual(2);
    expect(dismissed.length).toBeGreaterThanOrEqual(2);
    expect(accepted.length + dismissed.length).toBe(findings.length);
  });

  it('spreads the findings over more than one file', () => {
    // One file's worth of findings would make every case share a diff, and a
    // model answer that happens to fit that one file would pass all of them.
    expect(new Set(findings.map((f) => f.file)).size).toBeGreaterThan(1);
  });
});

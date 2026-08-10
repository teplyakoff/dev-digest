import type {
  Severity,
  SmartDiff,
  SmartDiffFile,
  SmartDiffFinding,
  SmartDiffGroup,
  SmartDiffRole,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { classifyPath } from './classify.js';
import {
  LARGE_FILE_LINES,
  ROLE_ORDER,
  SEVERITY_RANK,
  SPLIT_TOO_BIG_LINES,
} from './constants.js';

/**
 * Smart Diff — a PR's changed files, grouped by role and ordered by risk.
 *
 * ZERO TOKENS, AND STRUCTURALLY SO. This service never touches `container.llm`;
 * everything it returns is computed from two reads that already exist
 * (`pr_files` and the PR's persisted review findings) plus a pure path
 * classifier. That is not a promise made in a comment — there is no model
 * adapter reachable from this file, and the proof line it logs says what it was
 * computed FROM rather than congratulating itself.
 *
 * READ-ONLY on findings. It never writes one, never re-scores, never re-grounds.
 * The grounding invariant ("a finding that does not cite a real diff line is
 * dropped, and the score recomputes from the survivors") is not engaged here: by
 * the time a finding is in `findings`, grounding already ran.
 */

/**
 * The three fields Smart Diff reads off a `pr_files` row.
 *
 * DECLARED HERE, NOT INHERITED FROM THE REPOSITORY. `reviewRepo.getPrFiles`
 * returns `(typeof t.prFiles.$inferSelect)[]`, so letting the read take its type
 * from that signature makes this ring-2 service depend on an ORM row shape —
 * onion §5, "row types never cross inward", and §8, "row types stop here".
 *
 * The part that makes it worth a type rather than a comment: the dependency
 * would arrive with NO `db/schema` import, and `eslint.config.js`'s
 * `RING_2_FORBIDDEN` rule matches on imports. There is nothing for it to fire
 * on, so the ban would read as enforced while being structurally unenforceable
 * on this path. `reviews/diff-loader.ts` hit the same failure mode through
 * `Parameters<typeof loadDiff>[N]` and fixes it exactly this way (`DiffPullRef`,
 * `RepoRef`) — this is that remedy, applied to the second caller.
 */
interface PrFileRef {
  path: string;
  additions: number;
  deletions: number;
}

/**
 * The five fields Smart Diff reads off a `findings` row, structural for the same
 * reason as `PrFileRef`.
 *
 * `severity` is `string`, matching the `text` column rather than papering over
 * it: the database's own type is what the narrowing at the join has to be
 * honest about, and pretending the row arrives pre-narrowed would move that
 * claim out of sight.
 */
interface FindingRef {
  id: string;
  file: string;
  startLine: number;
  severity: string;
  title: string;
}

/**
 * One review and its findings, as `reviewRepo.reviewsForPull` hands them over —
 * reduced to the two review fields this service reads.
 *
 * `kind` keeps its literal union rather than widening to `string`, so the
 * `=== 'review'` test below is checked by the compiler instead of comparing a
 * string to a hopeful spelling.
 */
interface ReviewWithFindings {
  review: { id: string; kind: 'summary' | 'review' };
  findings: FindingRef[];
}

/**
 * The logger this service will accept — structurally, so it does not depend on
 * Fastify's concrete `FastifyBaseLogger` (onion §5: "a logger typed as the
 * concrete logger" never crosses inward). `req.log` satisfies it; so does a
 * two-line object in a test.
 *
 * Deliberately NOT `RunLogger.tool`: that publishes to the SSE bus and belongs
 * to a run. Smart Diff has no run, and a `tool` event with no run would put a
 * line in a trace that no run produced.
 */
export interface SmartDiffLogger {
  info(obj: unknown, msg?: string): void;
}

/** A file plus the keys the intra-group sort needs, none of which ship. */
interface RankedFile {
  file: SmartDiffFile;
  role: SmartDiffRole;
  changedLines: number;
  /** Rank of the most severe finding on this file; `Infinity` when it has none. */
  topSeverity: number;
}

export class SmartDiffService {
  constructor(private container: Container) {}

  /**
   * Build the Smart Diff for one PR.
   *
   * @param workspaceId the caller's workspace — the tenancy key, not a hint
   * @param prId        the PR, already validated as a uuid by the route schema
   * @param log         optional; the zero-token proof line goes here
   */
  async get(workspaceId: string, prId: string, log?: SmartDiffLogger): Promise<SmartDiff> {
    // 1. TENANCY GATE, FIRST, ALWAYS.
    //
    // `getPrFiles(prId)` and `reviewsForPull(prId)` take a PR id and nothing
    // else — neither can scope itself. This lookup IS the workspace boundary,
    // and reordering it below either read turns the endpoint into a
    // cross-workspace read of another tenant's file list and findings. Same
    // shape as `reviews/service.ts:161-163`.
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    // 2 + 3. Both reads go through the composition root's `reviewRepo`, never
    // through a sibling module's repository (onion §11) — and both are typed
    // through the structural refs above, so what crosses into this service is a
    // plain object with named fields and not a Drizzle row (§5).
    const files: PrFileRef[] = await this.container.reviewRepo.getPrFiles(prId);
    const reviews: ReviewWithFindings[] = await this.container.reviewRepo.reviewsForPull(prId);

    // ONE ROW PER AGENT, NOT ONE ROW PER REVIEW PASS — so join ALL of them.
    //
    // `reviewsForPull` is newest-first and returns `kind: 'summary'` rows as
    // well as `kind: 'review'` rows. Only the latter carry findings worth
    // joining, and the summary row stays excluded.
    //
    // This used to take the FIRST `kind: 'review'` row, on the assumption that
    // one row is one review of the PR. It is not: every agent that runs writes
    // its own row, so "the newest row" is "whichever agent finished last". On
    // the imported PR `d139cd8b` that was the API Contract Reviewer with 0
    // findings, while the Test Quality Reviewer (10) and the General Reviewer
    // (3) sat one row behind — the endpoint reported 0 of 13.
    //
    // THE TRADE-OFF IS CHOSEN, NOT OVERLOOKED. Re-running a single agent adds a
    // second row for it, and the superseded run's findings stay visible until
    // the older review is deleted. De-duplicating, or keeping only the newest
    // row per agent, was considered and declined: both need a rule for "same
    // finding" that the data does not carry, and both would silently hide a
    // finding an agent still reports. Do not add one here without reversing
    // this comment.
    //
    // No review at all is not an error: a PR that has never been reviewed still
    // gets its files grouped, ordered and counted, with `findings: []`
    // everywhere. Sorting works before any review exists — that is the point.
    const reviewRows = reviews.filter((r) => r.review.kind === 'review');

    // 4. Join persisted findings to persisted PR files BY PATH.
    //
    // A finding whose `file` matches no PR file is counted and logged, never
    // invented into a group: the alternative is a phantom file in the UI that
    // has no diff behind it. Whether the two producers (`pr_files.path` from the
    // GitHub detail payload, and the diff the reviewer grounded against) can
    // ever disagree on path form is an open question — the `unmatched` count in
    // the log line below is how it gets answered on real data.
    const known = new Set(files.map((f) => f.path));
    const byPath = new Map<string, SmartDiffFinding[]>();
    let matched = 0;
    let unmatched = 0;
    for (const row of reviewRows) {
      for (const f of row.findings) {
        if (!known.has(f.file)) {
          unmatched += 1;
          continue;
        }
        const list = byPath.get(f.file) ?? [];
        list.push({
          id: f.id,
          line: f.startLine,
          // Safe for the same reason `pulls/helpers.ts` gives: every write path
          // goes through the `Finding` contract, and since migration 0011 the
          // database has a CHECK constraint spelling out the same three values.
          severity: f.severity as Severity,
          title: f.title,
        });
        byPath.set(f.file, list);
        matched += 1;
      }
    }

    // 5. Classify, measure, derive.
    let totalLines = 0;
    const ranked: RankedFile[] = files.map((row) => {
      const findings = byPath.get(row.path) ?? [];
      const changedLines = row.additions + row.deletions;
      totalLines += changedLines;
      return {
        role: classifyPath(row.path),
        changedLines,
        topSeverity: severityFloor(findings),
        file: {
          path: row.path,
          // Populating this needs a model call, which this feature forbids. A
          // non-LLM stand-in (the first patch line, a function name) is worse
          // than null: the client renders a `Sparkles` chip beside it, which
          // tells the reader a model wrote it. Extension point, left empty.
          pseudocode_summary: null,
          additions: row.additions,
          deletions: row.deletions,
          // DERIVED from `findings`, never gathered separately — that is the
          // whole reason the contract makes both fields required.
          finding_lines: [...new Set(findings.map((f) => f.line))].sort((a, b) => a - b),
          findings,
          is_large: changedLines > LARGE_FILE_LINES,
        },
      };
    });

    // 6 + 7. Sort within each group, then emit the groups in ROLE_ORDER,
    // omitting the empty ones — an empty section renders as dead space.
    const groups: SmartDiffGroup[] = [];
    for (const role of ROLE_ORDER) {
      const inRole = ranked.filter((r) => r.role === role);
      if (inRole.length === 0) continue;
      groups.push({ role, files: inRole.sort(compareByRisk).map((r) => r.file) });
    }

    // 8. `proposed_splits` is always empty: generating it is a separate feature
    // (and the client renders the banner's body only when it is non-empty).
    const smartDiff: SmartDiff = {
      groups,
      split_suggestion: {
        too_big: totalLines > SPLIT_TOO_BIG_LINES,
        total_lines: totalLines,
        proposed_splits: [],
      },
    };

    // The zero-token proof. Grep-able as `SMART DIFF:` — the demo recording and
    // the manual verification both look for this line WITHOUT a `REVIEW model:`
    // or `INTENT CLASSIFIER model:` line beside it, which is what "no new model
    // call" looks like from outside the process.
    //
    // `reviews_joined` replaced `latest_review_id`, which stopped meaning
    // anything the moment findings came from many rows: one id out of five
    // reads as provenance while naming only the agent that happened to finish
    // last. The count says what was actually read, and it is the number that
    // moves when a review is deleted or an agent is re-run.
    log?.info(
      {
        pr_id: prId,
        files: files.length,
        reviews_joined: reviewRows.length,
        findings: matched,
        unmatched,
      },
      'SMART DIFF: computed from stored PR files + every stored review (no model call)',
    );

    return smartDiff;
  }
}

/**
 * The most severe finding's rank, or `Infinity` for a file with none.
 *
 * THE `?? Infinity` FALLBACK IS GONE, DELIBERATELY. It existed only because
 * `SEVERITY_RANK` was keyed by `string`; now that it is keyed by `Severity` the
 * lookup is total, and the case the fallback covered is caught one layer up —
 * adding a member to the contract's enum fails to compile in `constants.ts`
 * until it is given a rank. That is the direction that matters: a severity added
 * ABOVE `CRITICAL` and silently ranked `Infinity` would sort the worst findings
 * in the codebase LAST, and the fallback is what would have made that quiet.
 *
 * It also never did anything: `undefined < best` and `Infinity < best` are both
 * false while `best` is `Infinity`, so a rogue value ranks identically with or
 * without it. Protection that changes no outcome is a comment pretending to be
 * code.
 */
function severityFloor(findings: SmartDiffFinding[]): number {
  let best = Infinity;
  for (const f of findings) {
    const rank = SEVERITY_RANK[f.severity];
    if (rank < best) best = rank;
  }
  return best;
}

/**
 * Intra-group order, three keys and a tie-break:
 *
 *   1. files WITH findings before files without — the "business logic first"
 *      promise, and the one a comparator sign flip inverts silently;
 *   2. then the highest severity present (CRITICAL > WARNING > SUGGESTION);
 *   3. then more changed lines first;
 *   4. then path ascending.
 *
 * Key 4 is not cosmetic. Without it, two files equal on every other key come
 * back in whatever order the rows arrived in, so a test asserting the order
 * passes or fails on row order and the demo films a different list each take.
 *
 * The path comparison is codepoint order (`<`), NOT `localeCompare` — the latter
 * depends on the host's locale, which is exactly the reproducibility this key
 * exists to buy.
 */
function compareByRisk(a: RankedFile, b: RankedFile): number {
  const aHas = a.file.findings.length > 0 ? 0 : 1;
  const bHas = b.file.findings.length > 0 ? 0 : 1;
  if (aHas !== bHas) return aHas - bHas;
  if (a.topSeverity !== b.topSeverity) return a.topSeverity - b.topSeverity;
  if (a.changedLines !== b.changedLines) return b.changedLines - a.changedLines;
  if (a.file.path === b.file.path) return 0;
  return a.file.path < b.file.path ? -1 : 1;
}

import type { ReviewInput } from '@devdigest/reviewer-core';
import type {
  EvalBatchRecord,
  EvalCaseRecord,
  EvalExpectation,
  EvalRunRecord,
  EvalTrendPoint,
  FindingKind,
  LLMProvider,
  Provider,
  UnifiedDiff,
} from '@devdigest/shared';
import type { EvalExpectedFinding } from '@devdigest/reviewer-core';
import * as t from '../../db/schema.js';
import { EVAL_TRACE_ROLE, EVAL_REVIEW_STRATEGY, REGRESSION_PRECISION } from './constants.js';

/**
 * L06 / SPEC-08 — eval-pipeline pure helpers.
 *
 * Pure functions only: no I/O, no DB, no container, no clock. Everything here
 * is a value in → a value out, which is what lets the criteria that are really
 * about SHAPE (AC-20, AC-21, AC-44, AC-45, AC-46) be tested without a database
 * or a provider.
 */

export type FindingRow = typeof t.findings.$inferSelect;
export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalBatchRow = typeof t.evalRunBatches.$inferSelect;
export type EvalRunRow = typeof t.evalRuns.$inferSelect;

/**
 * Raised when an eval-run INVARIANT is violated — not when a case merely fails.
 *
 * The distinction is the whole point: the batch runner turns a thrown case into
 * an `errored` row and carries on (AC-39), which would quietly swallow a broken
 * invariant too. The runner re-throws this class instead, so a disarmed-scope
 * violation stops the batch loudly rather than becoming one more grey row.
 */
export class EvalInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalInvariantError';
  }
}

// ===========================================================================
// Case creation from a decided finding (AC-15…AC-21)
// ===========================================================================

/**
 * The direction a finding's DECISION implies (AC-15, AC-16), or `null` when it
 * has none (AC-17 — the caller turns that into a 422).
 *
 * Accepted wins if a row somehow carries both timestamps: "the reviewer agreed
 * this is real" is the stronger statement, and a case that asserts a finding
 * must be produced is the one worth keeping when the data is contradictory.
 */
export function expectationForFinding(
  finding: Pick<FindingRow, 'acceptedAt' | 'dismissedAt'>,
): EvalExpectation | null {
  if (finding.acceptedAt) return 'must_find';
  if (finding.dismissedAt) return 'must_not_flag';
  return null;
}

/**
 * The case's `expected_output`.
 *
 * `must_find` → EXACTLY ONE entry carrying the source finding's path and
 * `[start_line, end_line]` verbatim (AC-20). No normalisation of any kind: the
 * scorer compares paths character-for-character, so "tidying" the path here
 * would make the case unmatchable against the model's own citation.
 *
 * `must_not_flag` → an EMPTY ARRAY, and emphatically not `null` (AC-21). `null`
 * would read as "this case has no expectation recorded", which is a different
 * claim from "this case expects nothing to be reported".
 */
export function expectedOutputFor(
  expectation: EvalExpectation,
  finding: Pick<FindingRow, 'file' | 'startLine' | 'endLine' | 'kind'>,
): EvalExpectedFinding[] {
  if (expectation === 'must_not_flag') return [];
  return [
    {
      file: finding.file,
      start_line: finding.startLine,
      end_line: finding.endLine,
      // `findings.kind` is a plain `text` column guarded by `findings_kind_ck`,
      // so the runtime value is always a `FindingKind` — the cast narrows what
      // the CHECK already enforces and does not widen anything.
      kind: finding.kind as FindingKind,
    },
  ];
}

/** Read a persisted `expected_output` back into the scorer's shape, defensively. */
export function parseExpectedOutput(raw: unknown): EvalExpectedFinding[] {
  if (!Array.isArray(raw)) return [];
  const out: EvalExpectedFinding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const file = rec.file;
    const start = rec.start_line;
    const end = rec.end_line;
    if (typeof file !== 'string' || typeof start !== 'number' || typeof end !== 'number') continue;
    out.push({
      file,
      start_line: start,
      end_line: end,
      kind: typeof rec.kind === 'string' ? (rec.kind as FindingKind) : null,
    });
  }
  return out;
}

/** A human-readable case name derived from the finding it was seeded from. */
export function evalCaseName(
  finding: Pick<FindingRow, 'title' | 'file' | 'startLine' | 'endLine'>,
): string {
  return `${finding.title} — ${finding.file}:${finding.startLine}-${finding.endLine}`;
}

/**
 * Turn a stored `pr_files.patch` into a parseable unified diff for ONE file
 * (AC-19).
 *
 * GitHub's per-file `patch` is hunk text only — it starts at `@@` with no
 * `diff --git` / `+++` header, and `parseUnifiedDiff` needs the header to know
 * which file the hunks belong to. Without this the parse yields zero files and
 * every case would be `errored` for a reason that has nothing to do with the
 * agent. A patch that ALREADY carries a header is passed through untouched, so
 * a hand-written case or a differently-shaped import is not double-wrapped.
 *
 * The patch text itself is attacker-influenced (it comes from a cloned
 * third-party repo) and is NOT sanitised here — it reaches the model only
 * inside `wrapUntrusted`, under the shared `INJECTION_GUARD`, which
 * `assemblePrompt` applies on every review path. Scanning it for hostile text
 * here would be a second, weaker rule beside the one shared rule.
 */
export function toFileDiff(path: string, patch: string): string {
  // NO TRAILING NEWLINE, and that is a correctness rule rather than a style one.
  //
  // `parseUnifiedDiff` splits on '\n' and treats any line that is not '+', '-',
  // '@@' or a header as a CONTEXT line, which advances the new-side cursor and
  // marks that number covered. A terminating newline therefore yields a final
  // empty element that the parser counts as one more covered line: a 3-line
  // patch produced `newLineNumbers === [1, 2, 3, 4]`, and grounding admitted a
  // citation one line past the end of every case's last hunk.
  //
  // That is not cosmetic. `citation_accuracy` is one of the three graded
  // metrics, so the phantom line made the harness silently LENIENT on every
  // case in every batch — a finding cited just past the end of the diff
  // survived the gate that exists to fail it. Worse, it was lenient in only one
  // direction: the PR-review path reassembles its diff with
  // `diffFromPrFiles` (`modules/reviews/diff-loader.ts:47-58`), which joins the
  // parts with '\n' and appends no terminator. The harness was grading more
  // generously than the reviewer it is supposed to measure, which is precisely
  // backwards for a regression harness. Matching that function's output shape
  // exactly is the requirement here.
  //
  // Trailing newlines are stripped in full, not one: a patch ending '\n\n' would
  // otherwise keep a phantom line anyway. A blank final CONTEXT line in a valid
  // unified diff is ' ' (a space), not '', so this removes a terminator rather
  // than content — and where the two are genuinely ambiguous, dropping the line
  // errs strict, which lowers a metric visibly instead of inflating one silently.
  const body = patch.replace(/\n+$/, '');
  if (body.startsWith('diff --git ')) return body;
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${body}`;
}

// ===========================================================================
// What the engine sees (AC-44…AC-47, NFR-7, NFR-9)
// ===========================================================================

export interface EvalReviewInputArgs {
  /** The agent's CURRENT system prompt — input 1 of the three AC-44 allows. */
  systemPrompt: string;
  /** The agent's model — input 2. */
  model: string;
  /** Resolved skill BODIES, already rendered into prompt blocks — input 3. */
  skills: string[];
  /** The case's stored diff, already parsed. */
  diff: UnifiedDiff;
  llm: LLMProvider;
  signal?: AbortSignal;
}

/**
 * The eval run's invariant: the deterministic scope gate is NEVER armed
 * (AC-46).
 *
 * This is a THROW and not a comment on purpose. `applyScopeFilter` is a strict
 * identity pass-through while disarmed (`reviewer-core/src/review/scope.ts:77`),
 * and that is the only reason `ReviewOutcome.dropped` contains grounding drops
 * and nothing else — which is the only reason `citation_accuracy =
 * kept / (kept + dropped)` (AC-54) is the identity it claims to be. Arm the
 * filter and that number silently starts measuring something else. Nothing
 * anywhere else in the system would go red.
 */
export function assertScopeFilterDisarmed(input: ReviewInput): void {
  if (input.scopeFilter) {
    throw new EvalInvariantError(
      'scopeFilter is armed on an eval run (AC-46). citation_accuracy = kept/(kept+dropped) ' +
        'only holds while applyScopeFilter is the identity pass-through.',
    );
  }
  if (input.intent !== undefined) {
    throw new EvalInvariantError(
      'intent is set on an eval run (AC-45). It would append SCOPE_RULE to the system ' +
        'message and change the prompt two batches are supposed to be compared across.',
    );
  }
}

/**
 * Assemble the engine input for one eval case.
 *
 * The object literal is the criterion. `repoMap`, `memory`, `callers`, `intent`
 * and `prDescription` are ABSENT — not `undefined`, not `''`, not `null` (AC-45,
 * five separate assertions). `specs` is absent for the same reason even though
 * the criterion does not name it: a case carries its own diff and nothing else,
 * which is what makes two batches of the same set comparable at all.
 *
 * `strategy` is fixed rather than read from the agent (see
 * `EVAL_REVIEW_STRATEGY`) so the three AC-44 inputs really are three, and so a
 * batch of N cases makes exactly N model calls (NFR-5).
 *
 * The diff is handed to the engine as `diff`, which `assemblePrompt` renders
 * through `wrapUntrusted('diff', …)` with `INJECTION_GUARD` appended LAST to
 * the system message (`reviewer-core/src/prompt.ts:309`, `:193`). That is
 * AC-47 and NFR-9, and it is satisfied by using the shared path rather than by
 * a second wrapper here — wrapping again would nest the delimiters and make the
 * guard's own instruction ambiguous.
 */
export function buildEvalReviewInput(args: EvalReviewInputArgs): ReviewInput {
  const input: ReviewInput = {
    systemPrompt: args.systemPrompt,
    model: args.model,
    diff: args.diff,
    llm: args.llm,
    skills: args.skills,
    strategy: EVAL_REVIEW_STRATEGY,
    ...(args.signal ? { signal: args.signal } : {}),
  };
  assertScopeFilterDisarmed(input);
  return input;
}

/**
 * The trace line for one eval-run model call (NFR-7).
 *
 * Labelled by ROLE, never by the slug alone — an eval run and a PR review of
 * the same agent use the SAME model, so `deepseek/deepseek-v4-flash` in a trace
 * says nothing about which one produced it. Same technique as
 * `INTENT CLASSIFIER` (`modules/intent/service.ts:353`).
 */
export function evalTraceLine(caseName: string, provider: Provider, model: string): string {
  return `${EVAL_TRACE_ROLE} model: ${provider}/${model} (case ${caseName})`;
}

// ===========================================================================
// Aggregates and the regression banner (AC-51, AC-52, AC-56…AC-59)
// ===========================================================================

/**
 * The batch's cost: the sum over completed cases, or `null` when ANY completed
 * case's cost is unknown (AC-51 + AC-52).
 *
 * `null` is not zero and is not "we'll treat it as zero". A batch that billed
 * real money and reported `$0.00` is worse than one that admits it does not
 * know, because the first is quietly wrong on a spend figure.
 */
export function sumCaseCosts(costs: (number | null | undefined)[]): number | null {
  let total = 0;
  for (const c of costs) {
    if (c === null || c === undefined) return null;
    total += c;
  }
  return total;
}

/** `b − a`, or `null` when either side is unknown — never a delta against an unknown. */
export function metricDelta(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return round(b - a);
}

/**
 * `b − a` for money. Deliberately NOT rounded like `metricDelta`: a metric lives
 * in 0…1 where six decimals is a ten-thousandth of a percentage point, but a
 * cheap batch costs about $0.0003 and rounding it at the same scale would show
 * a real difference as zero.
 */
export function costDelta(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return b - a;
}

/**
 * The regression banner text (AC-56…AC-59). A DETERMINISTIC TEMPLATE — there is
 * no provider parameter here, so "zero model calls" (AC-57) is structural
 * rather than promised.
 *
 * - no previous batch → `''` (AC-58);
 * - a metric unknown in EITHER batch → not mentioned at all (AC-59), because a
 *   drop measured against an unknown is not a drop;
 * - fires at a fall of at least one percentage point, i.e. 0.01 on the 0…1
 *   scale (AC-56). The comparison is on rounded values so `-0.9 pp` and
 *   `-1.0 pp` are decided by the rule and not by IEEE 754 noise.
 */
export function regressionAlert(
  current: { recall: number | null; precision: number | null },
  previous: { recall: number | null; precision: number | null } | null,
  threshold: number,
): string {
  if (!previous) return '';

  const parts: string[] = [];
  for (const metric of ['recall', 'precision'] as const) {
    const before = previous[metric];
    const after = current[metric];
    if (before === null || after === null) continue;
    const drop = round(before - after);
    if (drop < threshold) continue;
    parts.push(`${metric} ${formatPct(before)} → ${formatPct(after)} (−${formatPoints(drop)} pp)`);
  }

  if (parts.length === 0) return '';
  return `Regression against the previous batch: ${parts.join('; ')}.`;
}

function round(n: number): number {
  const factor = 10 ** REGRESSION_PRECISION;
  return Math.round(n * factor) / factor;
}

function formatPct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function formatPoints(fraction: number): string {
  return (fraction * 100).toFixed(1);
}

// ===========================================================================
// Row → DTO mappers
// ===========================================================================

export function toCaseDto(row: EvalCaseRow): EvalCaseRecord {
  return {
    id: row.id,
    owner_kind: row.ownerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles ?? null,
    input_meta: row.inputMeta ?? null,
    expected_output: row.expectedOutput ?? null,
    notes: row.notes,
    expectation: row.expectation,
    source_finding_id: row.sourceFindingId,
  };
}

/**
 * `partial` is DERIVED from the status rather than stored twice — one fact, one
 * column. Carried on every response with aggregates (AC-43).
 */
export function toBatchDto(row: EvalBatchRow): EvalBatchRecord {
  return {
    id: row.id,
    agent_id: row.agentId,
    agent_version: row.agentVersion,
    system_prompt_snapshot: row.systemPromptSnapshot,
    provider: row.provider,
    model: row.model,
    status: row.status,
    cases_total: row.casesTotal,
    cases_completed: row.casesCompleted,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    cost_usd: row.costUsd,
    partial: row.status === 'partial',
    started_at: row.startedAt.toISOString(),
    finished_at: row.finishedAt?.toISOString() ?? null,
  };
}

export function toRunDto(row: EvalRunRow, caseName?: string | null): EvalRunRecord {
  return {
    id: row.id,
    case_id: row.caseId,
    case_name: caseName ?? null,
    ran_at: row.ranAt.toISOString(),
    actual_output: row.actualOutput ?? null,
    pass: row.pass,
    status: row.status,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
  };
}

/**
 * One trend point per FINISHED batch.
 *
 * `pass_rate` divides by `cases_total`, which is never zero because a batch
 * over an empty set is rejected with 422 before a row exists. The three metrics
 * are passed through as-is, including `null` — the contract carries the unknown
 * rather than the server inventing a `0` to fit it.
 */
export function toTrendPoint(row: EvalBatchRow, casesPassed: number): EvalTrendPoint {
  return {
    ran_at: (row.finishedAt ?? row.startedAt).toISOString(),
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    pass_rate: row.casesTotal > 0 ? casesPassed / row.casesTotal : 0,
    cost_usd: row.costUsd,
  };
}

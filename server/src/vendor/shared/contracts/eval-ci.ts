import { z } from 'zod';
import { Verdict, Finding } from './findings.js';
import {
  EvalRun,
  EvalCase,
  EvalOwnerKind,
  Conformance,
  Provider,
  CiFailOn,
} from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `EvalRun`, `EvalCase`, `EvalOwnerKind`, `Conformance` live in `knowledge.ts`;
 * here we add the *API-facing* request/response shapes (records persisted in
 * `eval_runs`, `composed_reviews`, `ci_installations`, `ci_runs`,
 * `conformance_checks`) plus the eval-dashboard aggregate.
 */

// ===========================================================================
// Eval — case input + persisted run record + dashboard
// ===========================================================================

/** Create/update payload for an eval case (id + owner resolved by the route). */
export const EvalCaseInput = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string().min(1),
  input_diff: z.string().default(''),
  input_files: z.unknown().nullish(),
  input_meta: z.unknown().nullish(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

/**
 * One case's outcome inside a batch. `errored` is deliberately distinct from
 * `failed`: the case never produced a comparable answer (unparseable diff,
 * timeout, provider error), which is not the same as producing a wrong one.
 * Mirrored by the `eval_runs_status_ck` CHECK in `server/src/db/schema/eval.ts`
 * — one edit in two places, change them together.
 */
export const EvalRunStatus = z.enum(['passed', 'failed', 'errored']);
export type EvalRunStatus = z.infer<typeof EvalRunStatus>;

/** A persisted eval run row (one execution of a case), returned by the API. */
export const EvalRunRecord = z.object({
  id: z.string(),
  case_id: z.string(),
  case_name: z.string().nullish(),
  ran_at: z.string(),
  actual_output: z.unknown(),
  pass: z.boolean().nullable(),
  /**
   * `pass` alone cannot say "errored": its `null` is already spoken for by
   * "metrics empty". Null here only for rows written before the column existed.
   */
  status: EvalRunStatus.nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

/** Result of running a single case: the metrics (EvalRun) + the persisted row id. */
export const EvalRunResult = z.object({
  run_id: z.string(),
  case_id: z.string(),
  result: EvalRun,
});
export type EvalRunResult = z.infer<typeof EvalRunResult>;

/** One point on the dashboard trend (per run, chronological). */
export const EvalTrendPoint = z.object({
  ran_at: z.string(),
  /**
   * Nullable for the same reason every other metric on this file is: a zero
   * denominator is UNKNOWN, and a batch whose set is entirely `must_not_flag`
   * has an unknown `recall` (AC-10) while still being a real point on the
   * trend. Non-nullable here forced the server to either fabricate a `0` — the
   * exact defect SPEC-08 is written against — or drop the batch from the trend
   * while the runs table still listed it. Relaxing is the permitted direction
   * (`reviewer-core/INSIGHTS.md:28-36`): no existing fixture breaks.
   */
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  /** Denominator is `cases_total`, and a batch with zero cases is rejected (422), so never unknown. */
  pass_rate: z.number(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

/**
 * DECLARATION ORDER IS LOAD-BEARING BELOW THIS LINE.
 *
 * `EvalDashboard` references `EvalBatchRecord` (its `latest_batch` field), and a
 * `z.object` body runs at import time — a forward reference is a TDZ
 * `ReferenceError` when the module loads, not a type error the compiler catches.
 * These two declarations were originally further down the file and were moved up
 * for exactly that reason; do not move them back.
 */

/**
 * Batch lifecycle. `partial` = it finished but at least one case did not pass
 * cleanly; `failed` = the batch itself could not run. Mirrored by the
 * `eval_run_batches_status_ck` CHECK — one edit in two places.
 */
export const EvalBatchStatus = z.enum(['running', 'complete', 'partial', 'failed']);
export type EvalBatchStatus = z.infer<typeof EvalBatchStatus>;

/**
 * A persisted batch row: every case of one agent run once, against a snapshot
 * of the exact prompt/version/provider/model that produced it. The snapshot is
 * what makes two batches comparable at all.
 */
export const EvalBatchRecord = z.object({
  id: z.string(),
  agent_id: z.string(),
  agent_version: z.number().int(),
  system_prompt_snapshot: z.string().nullable(),
  provider: Provider,
  model: z.string(),
  status: EvalBatchStatus,
  cases_total: z.number().int(),
  cases_completed: z.number().int(),
  recall: z.number().min(0).max(1).nullable(),
  precision: z.number().min(0).max(1).nullable(),
  citation_accuracy: z.number().min(0).max(1).nullable(),
  /** Null — not zero — when any completed case's cost is unknown. */
  cost_usd: z.number().nullable(),
  /** Carried on every response with aggregates, so a partial batch can never be read as a whole one. */
  partial: z.boolean(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});
export type EvalBatchRecord = z.infer<typeof EvalBatchRecord>;

/** Aggregate dashboard for an owner (agent/skill) or the whole workspace. */
export const EvalDashboard = z.object({
  owner_kind: EvalOwnerKind.nullable(),
  owner_id: z.string().nullable(),
  cases_total: z.number().int(),
  /**
   * The latest batch's aggregates. The three metrics are nullable for the same
   * reason `EvalRun`'s are: "no batch has ever run" and "the denominator was
   * zero" are both `null`, and the client renders a dash. A `0` here would be
   * read as a real, terrible score.
   */
  current: z.object({
    recall: z.number().nullable(),
    precision: z.number().nullable(),
    citation_accuracy: z.number().nullable(),
    traces_passed: z.number().int(),
    traces_total: z.number().int(),
    cost_usd: z.number().nullable(),
    /**
     * AC-43: EVERY response carrying batch aggregates carries the partial flag,
     * and the dashboard is one — without it a batch where three of eight cases
     * errored reads as a whole batch that simply scored badly. `EvalBatchRecord`
     * already carries its own; this is the same fact on the aggregate read.
     */
    partial: z.boolean(),
  }),
  /**
   * The NEWEST batch of any status, INCLUDING one still running — or `null` when
   * the agent has never had one.
   *
   * Deliberately a second channel beside `current`, and the two must not be
   * collapsed into one:
   *   - `current` is the LAST GOOD NUMBERS. It is the latest *finished* batch, so
   *     starting a new run does not replace a real score with three dashes for as
   *     long as the run takes.
   *   - `latest_batch` is the LIFECYCLE. It is how a client that did not itself
   *     receive the 202 — a second browser tab, or a page reloaded mid-batch —
   *     can tell that a run is in flight and keep the run action disabled.
   *     Without it the button is live during a run and the 409 on a concurrent
   *     batch becomes reachable through ordinary use rather than only a race.
   *
   * While a batch is running the two point at different rows; the rest of the
   * time `latest_batch` is the row `current`'s numbers came from.
   */
  latest_batch: EvalBatchRecord.nullable(),
  /**
   * Movement against the previous batch. `null` (the whole object) means there
   * IS no previous batch — absence, not "moved by zero". An individual field is
   * `null` when the metric is unknown in either batch, so a delta is never
   * computed against an unknown.
   */
  delta: z
    .object({
      recall: z.number().nullable(),
      precision: z.number().nullable(),
      citation_accuracy: z.number().nullable(),
    })
    .nullable(),
  trend: z.array(EvalTrendPoint),
  recent_runs: z.array(EvalRunRecord),
  alert: z.string().nullable(),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

// ===========================================================================
// Eval — expectation, case record, batch record, batch compare (L06)
// ===========================================================================

/**
 * What a case asserts about the agent's output: the finding must be produced
 * (`must_find`, from an ACCEPTED finding) or must not be (`must_not_flag`, from
 * a DISMISSED one).
 *
 * Mirrored EXACTLY by the `eval_cases_expectation_ck` CHECK in
 * `server/src/db/schema/eval.ts`, the same way `Severity` is mirrored by
 * `findings_severity_ck`. If this enum gains a member the CHECK is the second
 * edit — a mismatch shows up as an insert that fails at runtime, so change them
 * together.
 */
export const EvalExpectation = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectation = z.infer<typeof EvalExpectation>;

/**
 * Create/update payload for a HAND-WRITTEN eval case (the case editor's two
 * entry points). `EvalCaseInput` predates the `expectation` column and cannot
 * express a direction, but `eval_cases.expectation` is NOT NULL — so the
 * one-click path derives it from the finding's decision and this path asks for
 * it. Declared as an extension rather than a new object so the two shapes
 * cannot drift.
 */
export const EvalCaseUpsert = EvalCaseInput.extend({ expectation: EvalExpectation });
export type EvalCaseUpsert = z.infer<typeof EvalCaseUpsert>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type EvalCaseUpsertBody = z.input<typeof EvalCaseUpsert>;

/** A persisted eval case row — the base case plus its L06 provenance columns. */
export const EvalCaseRecord = EvalCase.extend({
  expectation: EvalExpectation,
  /**
   * The decided finding this case was created from. Becomes `null` when that
   * finding is deleted (`ON DELETE SET NULL`) — the case survives its origin.
   */
  source_finding_id: z.string().nullable(),
});
export type EvalCaseRecord = z.infer<typeof EvalCaseRecord>;

/** Response of `POST /findings/:id/eval-case`. */
export const CreateEvalCaseFromFinding = z.object({
  case: EvalCaseRecord,
  /**
   * Cases already created from the same finding. Creating a second one is
   * allowed; the caller is told about the others rather than blocked.
   */
  existing_cases: z.array(EvalCaseRecord),
});
export type CreateEvalCaseFromFinding = z.infer<typeof CreateEvalCaseFromFinding>;

/**
 * Two batches side by side ("old prompt vs new"). `comparable` is the SERVER's
 * decision — false when provider or model differ, because a metric move then
 * says nothing about the prompt. The client shows the flag, it does not
 * recompute it.
 */
export const EvalBatchCompare = z.object({
  a: EvalBatchRecord,
  b: EvalBatchRecord,
  /** b − a. A field is null when the metric is unknown in either batch. */
  deltas: z.object({
    recall: z.number().nullable(),
    precision: z.number().nullable(),
    citation_accuracy: z.number().nullable(),
    cost_usd: z.number().nullable(),
  }),
  comparable: z.boolean(),
  /** False when either batch has no prompt snapshot to diff against. */
  prompt_diff_available: z.boolean(),
});
export type EvalBatchCompare = z.infer<typeof EvalBatchCompare>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** One generated file in the CI bundle (path + editable contents). */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean().default(true),
});
export type CiFile = z.infer<typeof CiFile>;

/**
 * AgentManifest — the agent contract shared by the studio and the CI runner.
 *
 * The studio (`CiService.agentYaml`) WRITES this shape to
 * `.devdigest/agents/<slug>.yaml`; the agent-runner READS it. Keeping one Zod
 * schema for both ends guarantees the formats never drift. `skills` are slugs
 * resolved to `.devdigest/skills/<slug>.md`.
 */
export const AgentManifest = z.object({
  name: z.string().min(1),
  provider: Provider.default('openrouter'),
  model: z.string().min(1),
  system_prompt: z.string(),
  // Tolerate both a missing key and an explicit `null` (YAML `skills:` with no
  // value parses to null, which `.default([])` does NOT catch) — normalize both
  // to an empty array so manifests without skills validate cleanly.
  skills: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  strategy: z.enum(['auto', 'single-pass', 'map-reduce']).default('auto'),
  // CI gate policy (see CiFailOn) — when the posted review should BLOCK
  // (REQUEST_CHANGES + fail the check) vs just comment. Default: block on critical.
  ci_fail_on: CiFailOn.default('critical'),
});
export type AgentManifest = z.infer<typeof AgentManifest>;
/** Caller-facing input type — `.default()` fields stay optional. */
export type AgentManifestInput = z.input<typeof AgentManifest>;

/** Request body for `POST /agents/:id/export-ci`. */
export const CiExportInput = z.object({
  repo: z.string().min(1), // "owner/name"
  target: CiTarget.default('gha'),
  /** "open_pr" opens a PR with the files; "files" just returns/persists them. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: z.enum(['github_review', 'pr_comment', 'none']).default('github_review'),
  triggers: z.array(z.string()).default(['opened', 'synchronize', 'reopened']),
  base: z.string().default('main'),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** A persisted CI installation (mirrors `ci_installations`). */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
});
export type CiExport = z.infer<typeof CiExport>;

export const CiRunStatus = z.enum(['succeeded', 'failed', 'no_findings', 'running']);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  status: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  github_url: z.string().nullable(),
  source: z.string().nullable(),
  agent: z.string().nullish(),
  duration_s: z.number().nullish(),
});
export type CiRun = z.infer<typeof CiRun>;

/**
 * The artifact shape uploaded by the CI action (`devdigest-result.json`).
 * Ingested back on refresh to populate `ci_runs` (L06).
 */
export const CiResultArtifact = z.object({
  findings_count: z.number().int(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullish(),
  agent: z.string(),
  version: z.string().nullish(),
  pr_number: z.number().int().nullish(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;

import { z } from 'zod';
import { Severity } from './findings.js';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
/**
 * What a PR is FOR, as a claim. This is the core shape — the part a model may
 * propose and the part that is persisted as the answer.
 *
 * Everything about WHERE the claim came from (sources, what could not be read,
 * how confident, which model, what it cost) lives on `PrIntentRecord` in
 * `review-api.ts`, never here. That split is structural on purpose: the
 * classifier's schema extends THIS object, so it has nowhere to put a
 * hallucinated source — provenance is computed by the server from what it
 * actually collected.
 *
 * `summary` used to be `intent`, which made the composed brief read
 * `PrBrief.intent.intent`. Renamed in L03, while `pr_intent` still had zero
 * rows and zero callers.
 */
export const Intent = z.object({
  summary: z.string(),
  /** Short noun phrases: what this PR sets out to do. */
  in_scope: z.array(z.string()),
  /** Short noun phrases: what this PR DELIBERATELY does not do — not "things
      the classifier was not shown". */
  out_of_scope: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

/**
 * A persisted finding, reduced to what a Smart Diff line needs: the `id` a
 * click-through navigates to, the line it anchors on, and enough to render the
 * tag. `severity` reuses the `Severity` enum from `findings.ts` rather than
 * restating its three members — the DB CHECK constraint in migration `0011`
 * pins the same list, and a second copy here would drift from both.
 */
export const SmartDiffFinding = z.object({
  id: z.string(),
  line: z.number().int(),
  severity: Severity,
  title: z.string(),
});
export type SmartDiffFinding = z.infer<typeof SmartDiffFinding>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  /**
   * DERIVED from `findings`: `findings.map(f => f.line)`, sorted and
   * de-duplicated. Kept because it is part of the committed contract, but it is
   * NOT a second source — anything needing a finding's id, severity or title
   * reads `findings`. Producers must compute one from the other, never both.
   */
  finding_lines: z.array(z.number().int()),
  /**
   * This file's findings, unioned over EVERY stored review of the PR — one
   * `kind: 'review'` row is one AGENT, not one review pass, so taking only the
   * newest row reports whichever agent happened to finish last. A re-run agent's
   * superseded findings therefore stay visible until its older review is
   * deleted; that cost is chosen, and `smart-diff/service.ts` records why.
   *
   * REQUIRED, never optional: an optional field would make
   * `{ finding_lines: [28, 52], findings: undefined }` a legal payload — the
   * exact drift `finding_lines` being derived exists to prevent. A PR with no
   * review yet sends `[]`.
   */
  findings: z.array(SmartDiffFinding),
  /** `additions + deletions > LARGE_FILE_LINES`. Required for the same reason. */
  is_large: z.boolean(),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
  intent: Intent,
  blast: BlastRadius,
  risks: Risks,
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;

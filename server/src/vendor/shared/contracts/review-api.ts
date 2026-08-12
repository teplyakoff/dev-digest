import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import { Intent, SmartDiff } from './brief.js';

/**
 * A2 — Review-Core API surface contracts. These extend the core
 * Review/Finding/Intent/SmartDiff contracts with the persisted/transport shapes
 * the reviewer endpoints return. A2 owns this file; the barrel re-exports it.
 *
 * Distinct from `Finding` (the raw LLM-output unit): `FindingRecord` adds the
 * persisted row identity + action timestamps so the UI can render accept/dismiss
 * state and the `review_id` it belongs to.
 */

export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

/** A persisted review with its kept findings + grounding summary. */
export const ReviewRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  run_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  kind: z.enum(['summary', 'review']),
  verdict: Verdict.nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  model: z.string().nullable(),
  grounding: z.string().nullish(),
  created_at: z.string(),
  findings: z.array(FindingRecord),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/**
 * Response of `POST /pulls/:id/review`. Each requested agent produces a run that
 * streams over SSE at `/runs/:runId/events`; clients subscribe per run.
 *
 * **`reviews` is ALWAYS `[]` on this response.** The route is fire-and-forget:
 * `modules/reviews/service.ts` kicks off `executor.executeRuns(...)` with
 * `void … .catch(…)` and returns immediately, so nothing has been persisted yet
 * when the response is written. Reviews are read afterwards from
 * `GET /pulls/:id/reviews`, or waited for by polling `GET /pulls/:id/runs`.
 *
 * This comment previously claimed the reviews "are also returned once the
 * (synchronous) run completes", which was never true of the implementation. It
 * is corrected here rather than deleted because the field itself stays: a
 * caller that reads `reviews` and finds it empty needs to know that is by
 * design, not a failure.
 */
export const ReviewRunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type ReviewRunTarget = z.infer<typeof ReviewRunTarget>;

export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  reviews: z.array(ReviewRecord),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

// ---- PR intent (L03) ------------------------------------------------------
/**
 * How much the classifier trusts its own answer. A fixed value set, so an enum
 * rather than a string — and the SAME three members as the
 * `pr_intent_confidence_ck` CHECK in `db/schema/reviews.ts`. Those two are one
 * edit in two places: add a member here without adding it to the CHECK and the
 * insert fails at runtime.
 */
export const IntentConfidence = z.enum(['high', 'medium', 'low']);
export type IntentConfidence = z.infer<typeof IntentConfidence>;

/** Where one piece of the classifier's input came from. */
export const IntentSourceKind = z.enum([
  'pr_title',
  'pr_body',
  'linked_issue',
  'repo_file',
  'link',
  'changed_files',
]);
export type IntentSourceKind = z.infer<typeof IntentSourceKind>;

/**
 * `used` = it reached the model. `unavailable` = it was named but could not be
 * read (a 404 issue, a missing file, an external URL this product does not
 * fetch). The second state is the whole point: an unreachable link must be
 * visible as unreachable, never silently replaced by invention.
 */
export const IntentSourceStatus = z.enum(['used', 'unavailable']);
export type IntentSourceStatus = z.infer<typeof IntentSourceStatus>;

export const IntentSource = z.object({
  kind: IntentSourceKind,
  /** What it was: a path, `#301`, a URL, or a count for `changed_files`. */
  ref: z.string(),
  status: IntentSourceStatus,
  /** Why it is unavailable, when that needs saying. */
  note: z.string().nullish(),
});
export type IntentSource = z.infer<typeof IntentSource>;

/**
 * Intent persisted for a PR: the model's claim (`Intent`) plus the provenance
 * the SERVER computed around it.
 *
 * Every field below `Intent`'s three is server-owned. `sources` and
 * `missing_context` in particular are never returned by the model — the
 * classifier's schema (`modules/intent/pipeline/schema.ts`) has nowhere to put
 * them, which is the same trick `conventions/pipeline/schema.ts` plays with
 * evidence snippets.
 */
export const PrIntentRecord = Intent.extend({
  pr_id: z.string(),
  confidence: IntentConfidence,
  sources: z.array(IntentSource),
  /** Plain-language list of what could NOT be read, one entry per gap. */
  missing_context: z.array(z.string()),
  /** The commit this was derived against; a moved head makes it stale. */
  head_sha: z.string(),
  provider: z.string(),
  model: z.string(),
  derived_at: z.string(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  /** null = UNKNOWN, 0 = free. Never coalesce the two. */
  cost_usd: z.number().nullable(),
});
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;

/**
 * `GET`/`POST /pulls/:id/intent`. Mirrors `ConventionsView`'s `{scan: null}`
 * shape so "not derived yet" is a 200 with a null, not a 404 the client has to
 * special-case.
 */
export const PrIntentView = z.object({ intent: PrIntentRecord.nullable() });
export type PrIntentView = z.infer<typeof PrIntentView>;

/** Smart-diff response for a PR (the SmartDiff). */
export const SmartDiffResponse = SmartDiff;
export type SmartDiffResponse = z.infer<typeof SmartDiffResponse>;

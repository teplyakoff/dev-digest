import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import { Intent, Risk, RiskSeverity, SmartDiff } from './brief.js';

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

// ---------------------------------------------------------------------------
// Blast radius — `GET /pulls/:id/blast`.
//
// SEPARATE FROM `BlastRadius` in `brief.ts`, deliberately. That one is a PR
// Brief building block with a `summary` string a model writes; this one is the
// index read, and it has no summary because nothing here is written by a model.
// Merging them would put a field on the wire that the route can only ever send
// empty, and the first reader to fill it would be reaching for an LLM call this
// feature exists to avoid.
// ---------------------------------------------------------------------------

/**
 * `full` — the index covers the repo and the answer is complete.
 * `partial` — the index exists but is known incomplete (the indexer hit its
 *   budget, or the repo was too large), so absence of a caller proves nothing.
 * `degraded` — there is no usable index; nothing was computed.
 *
 * Three states, not a boolean, because `partial` and `degraded` call for
 * different words on screen: one says "this list may be short", the other says
 * "there is no list". Collapsing them is how an empty result starts reading as
 * a fact about the code.
 */
export const BlastStatus = z.enum(['full', 'partial', 'degraded']);
export type BlastStatus = z.infer<typeof BlastStatus>;

/** One call site of a changed symbol, in a file that is not the declaration. */
export const BlastCallerRef = z.object({
  file: z.string(),
  /** The enclosing top-level symbol at that line, or the file's basename. */
  symbol: z.string(),
  line: z.number().int(),
  /** `file_rank` of the caller's file — what the ordering is by. */
  rank: z.number(),
});
export type BlastCallerRef = z.infer<typeof BlastCallerRef>;

/**
 * A symbol declared in a changed file, with its callers.
 *
 * `callers_total` is separate from `callers.length` so a capped list can say
 * "20 of 47" rather than silently presenting the cap as the whole truth.
 */
export const BlastSymbolNode = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
  callers: z.array(BlastCallerRef),
  callers_total: z.number().int(),
});
export type BlastSymbolNode = z.infer<typeof BlastSymbolNode>;

/**
 * An HTTP route named in a file this PR changes, or in one that (transitively)
 * imports such a file.
 *
 * `depth` is hops along the reverse import graph, and the two ends of it are
 * different KINDS of claim, not just different distances:
 *
 *  - `0` — the route is named in a changed file. The indexer's extractor does
 *    not distinguish declaring a route from calling one, so this covers both a
 *    server `app.get('/repos')` and a client `api.get('/repos')`. Both are
 *    genuinely "HTTP surface this diff touches", which is why they share a
 *    bucket; neither is a graph result.
 *  - `1`–`2` — the declaring file imports a changed file, directly or through
 *    one module. This IS the graph result, and it weakens with distance.
 *
 * It is on the wire because a UI that cannot tell those apart states the weakest
 * of them with the confidence of the strongest.
 */
export const BlastEndpointRef = z.object({
  /** As extracted by the indexer, e.g. `GET /repos/:id`. */
  route: z.string(),
  /** The file the route string was found in. */
  file: z.string(),
  depth: z.number().int(),
  /** The changed file this was reached from (itself, at depth 0). */
  via: z.string(),
});
export type BlastEndpointRef = z.infer<typeof BlastEndpointRef>;

/** Same shape as an endpoint, for scheduled jobs. */
export const BlastCronRef = z.object({
  name: z.string(),
  file: z.string(),
  depth: z.number().int(),
  via: z.string(),
});
export type BlastCronRef = z.infer<typeof BlastCronRef>;

/**
 * `GET /pulls/:id/blast` — what else this diff can reach.
 *
 * Every field is read from the persistent `repo-intel` index. No model is
 * called on this path, and the response carries no free-text explanation,
 * because there is nothing here that was explained rather than looked up.
 */
export const BlastResponse = z.object({
  status: BlastStatus,
  /** Why the status is not `full`. Null when it is. */
  reason: z.string().nullable(),
  /** The PR's changed files, as the map was computed over them. */
  changed_files: z.array(z.string()),
  symbols: z.array(BlastSymbolNode),
  endpoints: z.array(BlastEndpointRef),
  crons: z.array(BlastCronRef),
  /** The commit the index was last built at — what the map is true of. */
  indexed_sha: z.string().nullable(),
  /**
   * TOTALS FOR THE WHOLE MAP, which is not the same as the length of the arrays
   * above and is the entire reason this object exists.
   *
   * `symbols` is capped before it ships, so `counts.symbols` can exceed
   * `symbols.length`; a consumer compares the two to say "showing 50 of 63"
   * rather than presenting a cap as the total. `counts.callers` likewise counts
   * every caller in the map, including those of symbols the cap dropped.
   *
   * This is the same promise `callers_total` makes one level down, and it was
   * briefly broken here: the counts were computed AFTER the slice, so a
   * truncated list reported its own length and nothing anywhere said it was
   * short. That is precisely the failure the feature exists to prevent — a cap
   * that reads as a fact about the code.
   */
  counts: z.object({
    symbols: z.number().int(),
    callers: z.number().int(),
    endpoints: z.number().int(),
  }),
});
export type BlastResponse = z.infer<typeof BlastResponse>;

// ---------------------------------------------------------------------------
// PR brief — `GET`/`POST /pulls/:id/brief`.
//
// SEPARATE FROM `PrBrief` in `brief.ts`, deliberately, and for the same reason
// `BlastResponse` above is separate from `BlastRadius`. That one composes four
// whole building blocks (`intent` + `blast` + `risks` + `history`) into a
// document nothing persists; this one is the row the brief endpoint reads and
// writes — one model call's five fields plus the provenance the SERVER computed
// around them. Reshaping the older contract to fit would drag `PrHistory`, for
// which there is no source of data, onto the wire; it stays where it is as the
// extension point it has always been.
// ---------------------------------------------------------------------------

/**
 * One file the reviewer should look at first, and why.
 *
 * There is NO line number here, and its absence is the design: a `file:line`
 * anchor computed against `head_sha` is exactly right by hand on a demo PR and
 * wrong on the first file that shifts. A path survives a rebase; a line does
 * not.
 */
export const ReviewFocusItem = z.object({
  path: z.string(),
  reason: z.string(),
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

/**
 * The brief's headline risk level. The same three values a `Risk` carries, and
 * the same enum — a second declaration would drift.
 */
export const BriefRiskLevel = RiskSeverity;
export type BriefRiskLevel = z.infer<typeof BriefRiskLevel>;

/**
 * The brief persisted for a PR: what the model said, plus everything the server
 * computed around it.
 *
 * `risks[]` reuses `Risk` from `brief.ts` unchanged, including
 * `file_refs: z.array(z.string())` with NO `.min(1)`. An empty array is legal
 * on the way IN and is rejected on the way out, by grounding, not by the
 * parser: a `.min(1)` here would turn a model that cited nothing into a
 * schema-repair round, and the repair budget for a brief is one.
 *
 * `dropped_blocks` and `unavailable_inputs` are two different absences and are
 * not interchangeable. The first is what the token budget removed (we had it,
 * it did not fit); the second is what we set out to read and could not (a 404
 * issue). Mirrors `pr_intent.missing_context`.
 */
export const PrBriefRecord = z.object({
  pr_id: z.string(),
  /** What the diff changes, in the model's words. */
  what: z.string(),
  /** Why it changes it. */
  why: z.string(),
  risk_level: BriefRiskLevel,
  risks: z.array(Risk),
  review_focus: z.array(ReviewFocusItem),
  /**
   * False when grounding dropped every risk the model returned. The headline
   * `risk_level` is still the model's, so the card can say "we could not
   * confirm these" instead of pretending there were none.
   */
  risks_grounded: z.boolean(),
  /** Named input blocks the token budget dropped, in the order it dropped them. */
  dropped_blocks: z.array(z.string()),
  /** Inputs that were named but could not be read, one entry per gap. */
  unavailable_inputs: z.array(z.string()),
  /** The commit this was built against; a moved head makes it stale. */
  head_sha: z.string(),
  provider: z.string(),
  model: z.string(),
  derived_at: z.string(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  /** null = UNKNOWN, 0 = free. Never coalesce the two. */
  cost_usd: z.number().nullable(),
  /** Model round-trips this build took: 1, or 2 when the schema was repaired. */
  attempts: z.number().int(),
});
export type PrBriefRecord = z.infer<typeof PrBriefRecord>;

/**
 * `GET`/`POST /pulls/:id/brief`. Like `PrIntentView`, "not built yet" is a 200
 * with a null, not a 404 the client has to special-case.
 *
 * `model_calls` counts what THIS request spent: 0 when the stored brief was
 * reused, 1 for a build on a fresh intent, 2 when the intent had to be derived
 * first. It is on the wire so the number is checkable from outside.
 */
export const PrBriefView = z.object({
  brief: PrBriefRecord.nullable(),
  /** The stored brief was built against a different head than the PR's. */
  stale: z.boolean(),
  /** The stored brief was returned as-is; no model was called. */
  reused: z.boolean(),
  model_calls: z.number().int(),
});
export type PrBriefView = z.infer<typeof PrBriefView>;

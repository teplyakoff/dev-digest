/**
 * L06 / SPEC-08 — eval-pipeline constants.
 *
 * Every literal the eval feature branches on lives here, so a threshold is
 * changed in one place and a test can import the same value it asserts against
 * instead of re-typing it.
 */

/**
 * Per-case wall-clock ceiling (NFR-10). A case that exceeds it is recorded
 * `errored` and the batch CONTINUES with the next one — one wedged provider
 * call must not cost the other seven cases their run.
 */
export const CASE_TIMEOUT_MS = 120_000;

/**
 * The regression threshold, as a FRACTION (AC-56 says "one percentage point").
 * Metrics are 0…1 everywhere in this system, so one percentage point is 0.01 —
 * writing `1` here would silence the banner permanently.
 *
 * On an eight-case set one case is 12.5 pp, so this currently means "any
 * regression at all"; the spec's Open questions record that and say to revisit
 * when the set grows.
 */
export const REGRESSION_THRESHOLD = 0.01;

/**
 * Rounding applied before the threshold comparison, in decimal places on the
 * 0…1 fraction. Without it `0.6 - 0.59` is `0.010000000000000009` in IEEE 754
 * and a "-1.0 pp fires / -0.9 pp does not" test is decided by float noise
 * rather than by the rule.
 */
export const REGRESSION_PRECISION = 6;

/**
 * The trace ROLE every eval-run model call is labelled with (NFR-7) — the same
 * technique as `INTENT CLASSIFIER` (`modules/intent/service.ts:353`). The slug
 * alone is not enough: an eval run and a PR review of the same agent use the
 * SAME model, so only the role distinguishes them in a trace.
 */
export const EVAL_TRACE_ROLE = 'EVAL RUN';

/**
 * How many batches the dashboard's trend carries, newest last.
 */
export const TREND_LIMIT = 20;

/** How many run rows the dashboard's "recent runs" table carries. */
export const RECENT_RUNS_LIMIT = 50;

/**
 * How many batch rows `GET /agents/:id/eval-batches` carries — the run history
 * the compare flow selects its two rows from.
 *
 * ONE unpaginated response, capped, which is the shape NFR-14 asks for: the
 * client gets the whole list in a single request and never assembles a page
 * cursor, but the server does not promise to serialise an unbounded table
 * either. Matched to `RECENT_RUNS_LIMIT` rather than to `TREND_LIMIT` because
 * this feeds a scrollable table, not a sparkline — 20 would silently hide older
 * batches from a comparison the user can legitimately want to make.
 *
 * If a set ever outgrows this, the honest fix is a documented cursor, not a
 * bigger number.
 */
export const BATCH_HISTORY_LIMIT = 50;

/**
 * Batch requests per minute, per the `security` skill's "AI generation" row
 * (3/min). A batch is N billed model calls behind one click, so this is the
 * tightest limit in the API and deliberately so (NFR-4).
 */
export const BATCH_RATE_LIMIT = { max: 3, timeWindow: '1 minute' } as const;

/**
 * The engine strategy an eval run uses, fixed rather than taken from the agent.
 *
 * AC-44 allows the engine EXACTLY THREE inputs from the agent's configuration
 * (system prompt, model, resolved skill bodies) and `strategy` is not one of
 * them. Fixing it to single-pass also buys NFR-5 outright: one case is one
 * model call, so a batch of N cases makes exactly N calls. `map-reduce` would
 * make one call per file and break that count.
 */
export const EVAL_REVIEW_STRATEGY = 'single-pass' as const;

/** `422` body message for AC-18 + AC-101 — the client toast shows this string. */
export const NO_DIFF_MESSAGE =
  'No diff fragment is stored for this finding’s file, so the case would assert nothing. ' +
  'Re-import the pull request so its files carry patch text, then try again.';

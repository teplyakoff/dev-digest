/**
 * Review module constants.
 */

/**
 * Studio review strategy. 'single-pass' = send the WHOLE diff in ONE LLM call.
 * We deliberately do NOT use 'auto'/map-reduce by default: map-reduce makes one
 * call PER FILE, which is slow and fragile (any single file's transient 5xx
 * fails the entire run) and unnecessary — the whole diff already fits the
 * model's context.
 */
export const REVIEW_STRATEGY = 'single-pass' as const;

/**
 * Hard deadline for ONE agent's review, in milliseconds.
 *
 * The provider SDK already has a per-REQUEST timeout (90 s on OpenRouter), but
 * nothing bounded a whole run: map-reduce multiplies that by the number of
 * chunks, each of those retries on 429/5xx, and the total was unbounded.
 * Measured runs of 945 s and 674 s sat in `running` against an 8–99 s norm on the
 * same PR and model, and because agents execute sequentially every agent queued
 * behind them waited too.
 *
 * 10 minutes is deliberately generous — roughly 6× the slowest healthy run
 * observed — so it never truncates legitimate work. It exists to convert
 * "wedged forever" into "failed, with a reason, and the queue moves on".
 */
export const RUN_DEADLINE_MS = 10 * 60 * 1000;

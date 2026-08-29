/* helpers.ts — pure formatting for EvalMetricStrip.

   ONE RULE GOVERNS THIS FILE: a metric is `number | null`, and `null` means
   UNKNOWN. Not zero, not one. Every function here returns `null` for an unknown
   input and lets the component render the em dash (`dashboard.unknownValue`),
   because the moment a formatter answers `"0%"` for an unknown denominator, a
   set that measures nothing looks either terrible or perfect — the single defect
   SPEC-08 is organised against (AC-72, AC-74).

   There is deliberately no `?? 0` anywhere in this folder. */

/** Which token colours a tile's value. `neutral` is the no-delta traces tile. */
export type MetricTone = "accent" | "ok" | "warn" | "neutral";

/**
 * A 0…1 metric as a whole-percent string, or `null` when it is unknown.
 *
 * `null` in, `null` out — the caller renders a dash. A genuine `0` is a known
 * value and DOES render as `"0%"`; that is not the case AC-72 forbids.
 */
export function formatPercent(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${Math.round(value * 100)}%`;
}

/**
 * "Traces passed" as `N/M`, or `null` when there is nothing to divide by.
 *
 * A zero denominator is the same unknown as a null metric: `0/0` is not "none
 * passed", it is "no batch has ever produced a case result". A batch that is
 * still running its first case has `traces_total === 0` and lands here too.
 */
export function formatRatio(
  passed: number | null | undefined,
  total: number | null | undefined,
): string | null {
  if (passed == null || total == null || total <= 0) return null;
  return `${passed}/${total}`;
}

/**
 * A 0…1 delta as whole percentage points, or `null` when there is no delta.
 *
 * `null` here means ABSENT — no previous batch, or the metric was unknown in
 * one of the two batches — and the caller renders no badge at all (AC-73). A
 * delta that is genuinely zero returns `0`, which IS rendered: absence and
 * "moved by zero" must not look alike.
 */
export function deltaPoints(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** `▲ 3pt` / `▼ 12pt` — the sign lives in the arrow, so the number is absolute. */
export function formatDeltaPoints(points: number): string {
  return `${points >= 0 ? "▲" : "▼"} ${Math.abs(points)}pt`;
}

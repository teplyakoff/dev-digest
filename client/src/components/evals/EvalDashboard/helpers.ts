/* helpers.ts — pure logic for EvalDashboard: the banner's guard and the trend
   chart's geometry.

   THE RULE: a metric is `number | null`, and `null` means UNKNOWN. The trend
   chart therefore draws a GAP where a point's metric is unknown, and never a
   line down to zero — a batch whose set is entirely `must_not_flag` has an
   unknown recall (AC-10) while still being a real point on the trend. There is
   no `?? 0` in this folder. */

import type { EvalDashboard, EvalTrendPoint } from "@devdigest/shared";

/**
 * The regression banner's text, or `null` when there is no banner to render.
 *
 * The sentence arrives ALREADY COMPOSED from the server, computed
 * deterministically with zero model calls (AC-57). This function's only job is
 * the AC-93 / AC-94 pair: text → render the banner, empty or absent → render
 * nothing at all. Whitespace-only counts as empty, because a live region filled
 * with a blank string is exactly what NFR-13's second clause forbids.
 */
export function alertText(dashboard: EvalDashboard | null | undefined): string | null {
  const raw = dashboard?.alert;
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Whether this agent has ever had a batch (AC-85).
 *
 * `latest_batch` is the lifecycle channel and covers a batch still running —
 * one that has no trend point yet but is emphatically not "no runs". `trend`
 * covers finished batches. Either one means there is something to show.
 */
export function hasRuns(dashboard: EvalDashboard | null | undefined): boolean {
  if (!dashboard) return false;
  return dashboard.latest_batch != null || dashboard.trend.length > 0;
}

/** Which metric a trend series draws, and how it is labelled and coloured. */
export type TrendMetric = "recall" | "precision" | "citation_accuracy";

export interface TrendPointXY {
  x: number;
  y: number;
}

/**
 * A contiguous run of KNOWN points. One point → a dot; two or more → a
 * polyline. Splitting on unknown values is what keeps a gap a gap.
 */
export interface TrendSegment {
  points: TrendPointXY[];
}

/**
 * Project one metric's series onto an SVG viewBox of `width` × `height`.
 *
 * Two edge cases are the reason this is a tested function rather than inline
 * arithmetic:
 *
 *   - EXACTLY ONE POINT (AC-95). `i / (n - 1)` is `0 / 0` — `NaN` — which
 *     renders an invisible, invalid path rather than throwing, so the bug ships
 *     silently. A single point is centred instead.
 *   - AN UNKNOWN VALUE. It ends the current segment and starts a new one after
 *     the gap; it is never plotted at zero.
 *
 * The y axis is the full 0…1 range with y growing downward, as SVG has it.
 */
export function trendSegments(
  points: readonly EvalTrendPoint[],
  metric: TrendMetric,
  width: number,
  height: number,
): TrendSegment[] {
  const n = points.length;
  if (n === 0) return [];

  const segments: TrendSegment[] = [];
  let current: TrendPointXY[] = [];

  points.forEach((point, i) => {
    const value = point[metric];
    if (value == null || !Number.isFinite(value)) {
      if (current.length > 0) segments.push({ points: current });
      current = [];
      return;
    }
    const x = n === 1 ? width / 2 : (i / (n - 1)) * width;
    const clamped = Math.min(1, Math.max(0, value));
    current.push({ x, y: height - clamped * height });
  });

  if (current.length > 0) segments.push({ points: current });
  return segments;
}

/** An SVG `points` attribute for one segment. */
export function polylinePoints(segment: TrendSegment): string {
  return segment.points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

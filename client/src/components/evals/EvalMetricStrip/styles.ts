import type { CSSProperties } from "react";
import type { MetricTone } from "./helpers";

/* Co-located styles for EvalMetricStrip (design: `screen_agents.jsx:139-155`).

   Style OBJECTS consumed as `style={s.x}`, plus FUNCTIONS that return the WHOLE
   computed style for the parts that vary. A spread in JSX
   (`style={{ ...s.value, ...tone(x) }}`) is two `no-restricted-syntax` errors,
   not zero (`client/INSIGHTS.md`) — `metricValueStyle` exists for that reason,
   the same shape as `swatchFor` in `SmartDiffViewer/styles.ts`. */

export const s = {
  strip: { display: "flex", gap: 10 } satisfies CSSProperties,
  tile: {
    flex: 1,
    minWidth: 0,
    padding: "11px 13px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  label: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    marginBottom: 6,
  } satisfies CSSProperties,
  valueRow: { display: "flex", alignItems: "baseline", gap: 7 } satisfies CSSProperties,
  /** The em dash. Muted on purpose: unknown must not read as a headline number. */
  unknown: { fontSize: 22, fontWeight: 700, color: "var(--text-muted)" } satisfies CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 8,
  } satisfies CSSProperties,
  note: { fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 } satisfies CSSProperties,
  /** Carries the partial badge's tooltip — `Badge` itself takes no `title`. */
  partialWrap: { display: "inline-flex", cursor: "help" } satisfies CSSProperties,
} as const;

const TONE_COLOR: Record<MetricTone, string> = {
  accent: "var(--accent)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  neutral: "var(--text-secondary)",
};

/** A tile's headline number, coloured by its metric's token. */
export function metricValueStyle(tone: MetricTone): CSSProperties {
  return { fontSize: 22, fontWeight: 700, color: TONE_COLOR[tone] };
}

/**
 * The `▲ / ▼ Npt` badge.
 *
 * A zero delta is a KNOWN zero and gets the neutral colour rather than the green
 * of an improvement — the arrow still follows the design's `>= 0` rule, but
 * nothing about a flat metric should read as progress.
 */
export function deltaBadgeStyle(points: number): CSSProperties {
  const color =
    points > 0 ? "var(--ok)" : points < 0 ? "var(--crit)" : "var(--text-secondary)";
  return { fontSize: 11.5, fontWeight: 600, color };
}

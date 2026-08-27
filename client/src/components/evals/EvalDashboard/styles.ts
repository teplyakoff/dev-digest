import type { CSSProperties } from "react";

/* Co-located styles for EvalDashboard (design:
   `screen_skillslab_evaldashboard.jsx:393-477`).

   Style OBJECTS consumed as `style={s.x}`, plus FUNCTIONS returning the WHOLE
   computed style where it varies — a spread in JSX is two
   `no-restricted-syntax` errors, not zero (`client/INSIGHTS.md`). */

export const s = {
  root: { display: "flex", flexDirection: "column", gap: 18 } satisfies CSSProperties,

  /**
   * The live region (NFR-13). Always mounted and usually EMPTY: a region that
   * appears at the same moment as its text announces nothing, and an empty
   * string rendered into it on every poll is what the second clause forbids.
   */
  live: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  alert: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "11px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
  alertIcon: { color: "var(--warn)", flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  alertTitle: { fontSize: 13, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  alertBody: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginTop: 2,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  status: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,

  loading: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  noRuns: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
    padding: "22px 18px",
    borderRadius: 8,
    border: "1px dashed var(--border-strong)",
    background: "var(--bg-surface)",
    textAlign: "center",
  } satisfies CSSProperties,

  trendHeader: { display: "flex", alignItems: "center", gap: 16 } satisfies CSSProperties,
  legend: { marginLeft: "auto", display: "flex", gap: 14, fontSize: 11.5 } satisfies CSSProperties,
  legendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  chartFrame: { width: "100%" } satisfies CSSProperties,
  chart: { width: "100%", height: 200, display: "block", overflow: "visible" } satisfies CSSProperties,
} as const;

const SERIES_COLOR = {
  recall: "var(--accent)",
  precision: "var(--ok)",
  citation_accuracy: "var(--warn)",
} as const;

export type SeriesKey = keyof typeof SERIES_COLOR;

export function seriesColor(key: SeriesKey): string {
  return SERIES_COLOR[key];
}

/** A legend swatch, painted with its series' token. */
export function legendSwatchStyle(key: SeriesKey): CSSProperties {
  return { width: 10, height: 2, background: SERIES_COLOR[key], borderRadius: 2, flexShrink: 0 };
}

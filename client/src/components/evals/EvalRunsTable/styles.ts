import type { CSSProperties } from "react";

/* Co-located styles for EvalRunsTable (design:
   `screen_skillslab_evaldashboard.jsx:461-477`).

   Style OBJECTS consumed as `style={s.x}`, plus FUNCTIONS returning the WHOLE
   computed style for the parts that vary. A spread in JSX
   (`style={{ ...s.row, ...selected }}`) is two `no-restricted-syntax` errors,
   not zero (`client/INSIGHTS.md`), which is why `rowStyle` exists. */

export const s = {
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  } satisfies CSSProperties,
  /** SectionLabel carries its own bottom margin; this row owns the spacing. */
  headerLabel: { display: "flex", alignItems: "center" } satisfies CSSProperties,
  hint: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  headerActions: { marginLeft: "auto" } satisfies CSSProperties,
  frame: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 12.5,
    textAlign: "left",
  } satisfies CSSProperties,
  th: {
    padding: "9px 16px",
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  thSelect: {
    padding: "9px 8px 9px 16px",
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
    width: 34,
  } satisfies CSSProperties,
  td: {
    padding: "10px 16px",
    borderBottom: "1px solid var(--border)",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  tdSelect: {
    padding: "10px 8px 10px 16px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  checkbox: { width: 15, height: 15, cursor: "pointer" } satisfies CSSProperties,
  ranAt: { color: "var(--text-secondary)", fontSize: 11.5 } satisfies CSSProperties,
  /** The em dash. Muted on purpose: unknown must not read as a number. */
  unknown: { color: "var(--text-muted)", cursor: "help" } satisfies CSSProperties,
} as const;

const METRIC_COLOR = {
  recall: "var(--accent)",
  precision: "var(--ok)",
  citation: "var(--warn)",
} as const;

export type MetricKey = keyof typeof METRIC_COLOR;

/** A metric cell's value, coloured by its metric's token. */
export function metricCellStyle(metric: MetricKey): CSSProperties {
  return { fontWeight: 600, color: METRIC_COLOR[metric] };
}

/** A row, tinted while it is one of the two selected for comparison. */
export function rowStyle(selected: boolean): CSSProperties {
  return { background: selected ? "var(--bg-hover)" : "transparent" };
}

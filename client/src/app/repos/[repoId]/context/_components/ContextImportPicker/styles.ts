import type { CSSProperties } from "react";

/** Co-located styles for the import picker. */
export const s = {
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 14,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  title: {
    fontSize: 13,
    fontWeight: 650,
    color: "var(--text-primary)",
    marginRight: "auto",
  } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    maxHeight: 320,
    overflowY: "auto",
  } satisfies CSSProperties,
  row: (skipped: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 8px",
    borderRadius: 6,
    background: "transparent",
    border: "1px solid transparent",
    textAlign: "left",
    width: "100%",
    // Not merely styled grey: the control itself is disabled, so the row cannot
    // be selected by click, by Enter, or by anything else.
    cursor: skipped ? "not-allowed" : "pointer",
    color: skipped ? "var(--text-muted)" : "var(--text-primary)",
  }),
  path: {
    flex: 1,
    fontSize: 12.5,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  reason: { fontSize: 11.5, color: "var(--warning, var(--text-muted))" } satisfies CSSProperties,
  size: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;

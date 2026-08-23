import type { CSSProperties } from "react";

/** Co-located styles for the attachment tab. */
export const s = {
  panel: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  tabs: { display: "flex", gap: 6 } satisfies CSSProperties,
  targets: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  target: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: 12,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  targetHead: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  targetName: { fontSize: 13, fontWeight: 650, color: "var(--text-primary)" } satisfies CSSProperties,
  targetMeta: { marginLeft: "auto", fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  warn: { fontSize: 11.5, color: "var(--warning, var(--text-secondary))" } satisfies CSSProperties,
  docs: { display: "flex", flexWrap: "wrap", gap: 6 } satisfies CSSProperties,
  /**
   * State is exposed through `aria-pressed`, and the colour here only follows
   * it. Colour alone is not a state a screen reader can read, and NFR-6's
   * threshold is that the state is legible without it.
   */
  doc: (attached: boolean, missing: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 9px",
    borderRadius: 999,
    fontSize: 12,
    cursor: "pointer",
    border: `1px solid ${attached ? "var(--accent)" : "var(--border)"}`,
    background: attached ? "var(--bg-hover)" : "transparent",
    color: missing ? "var(--text-muted)" : "var(--text-primary)",
    textDecoration: missing ? "line-through" : "none",
  }),
  empty: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;

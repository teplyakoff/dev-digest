import type { CSSProperties } from "react";

/** Co-located styles for DiffTab (style objects, `style={s.x}`). */
export const s = {
  /** SectionLabel's right slot: the comments button, then the view toggle. */
  headerRight: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  /** Segmented control (design: SmartDiff's smart/original switch). */
  toggleGroup: {
    display: "flex",
    gap: 2,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: 2,
  } satisfies CSSProperties,
  loading: { marginTop: 4 } satisfies CSSProperties,
} as const;

/** One segment of the view toggle; the active one is raised, not coloured. */
export function toggleButtonFor(active: boolean): CSSProperties {
  return {
    padding: "3px 11px",
    fontSize: 11.5,
    fontWeight: 600,
    borderRadius: 5,
    border: "none",
    cursor: "pointer",
    background: active ? "var(--bg-elevated)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
  };
}

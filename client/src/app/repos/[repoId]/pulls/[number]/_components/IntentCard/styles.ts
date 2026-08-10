import type { CSSProperties } from "react";

export const s = {
  wrap: { marginBottom: 18 } satisfies CSSProperties,
  summary: {
    fontSize: 14,
    lineHeight: 1.55,
    fontStyle: "italic",
    color: "var(--text-primary)",
    margin: 0,
    paddingLeft: 12,
    borderLeft: "2px solid var(--border-strong)",
  } satisfies CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 20,
    marginTop: 16,
  } satisfies CSSProperties,
  colLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 8,
  } satisfies CSSProperties,
  list: {
    listStyle: "disc",
    margin: 0,
    paddingLeft: 18,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  item: { fontSize: 13, lineHeight: 1.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  footer: {
    marginTop: 16,
    paddingTop: 12,
    borderTop: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  provenance: { fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 } satisfies CSSProperties,
  /**
   * Warning-coloured, and that is the point rather than the decoration: this
   * line is the whole mechanism by which "an unreachable link must not be
   * silently replaced by invention" is visible to a human.
   */
  missing: {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--warn)",
  } satisfies CSSProperties,
  emptyState: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  emptyText: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  /** The SectionLabel's right slot: badges then the re-derive button. */
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  okIcon: { color: "var(--ok)" } satisfies CSSProperties,
  mutedIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  /** Keeps the warning triangle aligned with the first line of wrapped text. */
  missingIcon: { flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
};

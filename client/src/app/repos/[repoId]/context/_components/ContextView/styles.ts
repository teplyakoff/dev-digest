import type { CSSProperties } from "react";

/** Co-located styles for the Project Context page. */
export const s = {
  page: { padding: "20px 28px 40px", maxWidth: 1040, margin: "0 auto" } satisfies CSSProperties,
  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 18,
  } satisfies CSSProperties,
  headerMain: { flex: 1 } satisfies CSSProperties,
  heading: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", marginTop: 3 } satisfies CSSProperties,
  status: { fontSize: 12, color: "var(--text-muted)", marginTop: 4 } satisfies CSSProperties,
  actions: { display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" } satisfies CSSProperties,
  /**
   * A two-column grid, not a flex row.
   *
   * A flex row whose children stretch takes its height from the tallest child,
   * which is how a long document silently changes the height of everything
   * beside it. `align-items: start` plus the viewer's own fixed body height keeps
   * a 60 kB document from resizing the list next to it.
   */
  columns: {
    display: "grid",
    gridTemplateColumns: "minmax(220px, 300px) minmax(0, 1fr)",
    alignItems: "start",
    gap: 20,
  } satisfies CSSProperties,
  section: { marginTop: 28 } satisfies CSSProperties,
  sectionTitle: {
    fontSize: 13,
    fontWeight: 650,
    color: "var(--text-primary)",
    marginBottom: 10,
  } satisfies CSSProperties,
  nameRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    marginBottom: 16,
  } satisfies CSSProperties,
  nameInput: {
    flex: "0 1 320px",
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    fontSize: 13,
  } satisfies CSSProperties,
  skeletonRow: { marginBottom: 10 } satisfies CSSProperties,
  hidden: { display: "none" } satisfies CSSProperties,
} as const;

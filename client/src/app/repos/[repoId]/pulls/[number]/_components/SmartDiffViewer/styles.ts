import type { CSSProperties } from "react";

/** Co-located styles for SmartDiffViewer (style OBJECTS, as everywhere in this
    route — consumed as `style={s.x}`, never as class strings). */
export const s = {
  summaryStrip: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    marginBottom: 14,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  stat: { fontSize: 12.5 } satisfies CSSProperties,
  addText: { color: "var(--code-add-text)" } satisfies CSSProperties,
  delText: { color: "var(--code-del-text)" } satisfies CSSProperties,
  sep: { color: "var(--text-muted)" } satisfies CSSProperties,

  // ---- Large-PR banner (design: SplitBanner) ------------------------------
  banner: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    border: "1px solid var(--warn)",
    borderRadius: 8,
    background: "var(--warn-bg)",
    padding: 14,
    marginBottom: 14,
  } satisfies CSSProperties,
  bannerIcon: { color: "var(--warn)", flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  bannerTitle: { fontSize: 13.5, fontWeight: 650, color: "var(--text-primary)" } satisfies CSSProperties,
  bannerBody: { fontSize: 12.5, color: "var(--text-secondary)", marginTop: 6 } satisfies CSSProperties,

  // ---- Role groups --------------------------------------------------------
  group: { marginBottom: 18 } satisfies CSSProperties,
  /**
   * Sticky, and therefore opaque. The design's header has `position: sticky`
   * with no background and no stacking context, which works in the mock because
   * nothing scrolls under it — port it as-is and diff rows read straight through
   * the label. `background` + `zIndex` are the fix, not decoration.
   */
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: "6px 0",
    marginBottom: 8,
    position: "sticky",
    top: 0,
    zIndex: 2,
    background: "var(--bg-primary)",
  } satisfies CSSProperties,
  groupLabel: { fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  groupDesc: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  groupCount: { marginLeft: "auto", fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  groupFiles: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
} as const;

/** The 8×8 role swatch beside a group label. */
export function swatchFor(color: string): CSSProperties {
  return { width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 };
}

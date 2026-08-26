import type { CSSProperties } from "react";

/** Co-located styles for the document viewer/editor. */
export const s = {
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    minWidth: 0,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  name: {
    fontSize: 14,
    fontWeight: 650,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  headerRight: { marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" } satisfies CSSProperties,
  meta: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  /**
   * The body pane owns its own height and scroll rather than stretching.
   *
   * A flex row whose children stretch takes its height from the tallest child,
   * which is how an editor's `rows` silently stopped meaning anything once. It
   * looks correct on a short document and degrades with length — so a screenshot
   * proves nothing here, and the fixed box is the fix.
   */
  body: {
    height: 420,
    overflowY: "auto",
    padding: "12px 14px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    fontSize: 13,
  } satisfies CSSProperties,
  editor: (saving: boolean): CSSProperties => ({
    height: 420,
    width: "100%",
    resize: "vertical",
    padding: "12px 14px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 12.5,
    lineHeight: 1.55,
    opacity: saving ? 0.6 : 1,
  }),
  error: { fontSize: 12.5, color: "var(--danger)" } satisfies CSSProperties,
} as const;

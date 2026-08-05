import type { CSSProperties } from "react";

/** Co-located styles for the skill editor page shell (list + editor columns). */
export const s = {
  split: { display: "flex", height: "calc(100vh - 52px)" } satisfies CSSProperties,
  listCol: {
    width: 290,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  listHead: { padding: "16px 16px 12px" } satisfies CSSProperties,
  listTitle: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  listScroll: { flex: 1, overflow: "auto", padding: "0 12px 12px" } satisfies CSSProperties,

  skeletonCol: {
    flex: 1,
    padding: 28,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,

  editorCol: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  } satisfies CSSProperties,
  editorHead: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "16px 28px 0",
    flexShrink: 0,
  } satisfies CSSProperties,
  editorTitle: { fontSize: 17, fontWeight: 700 } satisfies CSSProperties,
  editorScroll: { flex: 1, minHeight: 0, overflow: "auto" } satisfies CSSProperties,
  typeIcon: (color: string): CSSProperties => ({ color }),
} as const;

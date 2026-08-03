import type { CSSProperties } from "react";

/** Co-located styles for SkillPreviewDrawer. */
export const s = {
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  } satisfies CSSProperties,
  tokens: {
    marginLeft: "auto",
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  vetting: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    background: "var(--warn-bg)",
    border: "1px solid var(--warn)",
    borderRadius: 8,
    padding: "10px 13px",
    marginBottom: 14,
  } satisfies CSSProperties,
  body: {
    fontSize: 13,
    color: "var(--text-secondary)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: "14px 16px",
  } satisfies CSSProperties,
} as const;

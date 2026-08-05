import type { CSSProperties } from "react";

/** Co-located styles for the conventions CreateSkillModal. */
export const s = {
  body: { padding: "18px 22px 8px" } satisfies CSSProperties,
  /** The "merged from N accepted conventions" banner. */
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 13px",
    borderRadius: 8,
    background: "var(--accent-bg)",
    border: "1px solid var(--border)",
    marginBottom: 18,
  } satisfies CSSProperties,
  bannerIcon: { color: "var(--accent)", flexShrink: 0 } satisfies CSSProperties,
  bannerText: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  bannerStrong: { color: "var(--text-primary)" } satisfies CSSProperties,
  bannerRepo: { color: "var(--accent-text)" } satisfies CSSProperties,
  splitRow: { display: "flex", gap: 14 } satisfies CSSProperties,
  splitCell: { flex: 1 } satisfies CSSProperties,
  toggleCell: { display: "flex", alignItems: "center", height: 36 } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  footerNote: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    marginRight: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  footerVersion: { color: "var(--text-secondary)" } satisfies CSSProperties,
  error: { fontSize: 12.5, color: "var(--danger)", marginRight: "auto" } satisfies CSSProperties,
  loading: { padding: "28px 22px", color: "var(--text-muted)", fontSize: 13 } satisfies CSSProperties,
} as const;

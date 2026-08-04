import type { CSSProperties } from "react";

/** Co-located styles for the Conventions page. Ported from `screen_conv_conf.jsx`. */
export const s = {
  page: { padding: "20px 28px 40px", maxWidth: 880, margin: "0 auto" } satisfies CSSProperties,
  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 18,
  } satisfies CSSProperties,
  heading: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  repoName: { color: "var(--accent-text)" } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginTop: 3,
  } satisfies CSSProperties,
  dropped: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginTop: 4,
    cursor: "help",
  } satisfies CSSProperties,
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  } satisfies CSSProperties,
  toolbarCount: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  toolbarRight: { marginLeft: "auto" } satisfies CSSProperties,
  error: { fontSize: 12.5, color: "var(--danger)", marginRight: "auto" } satisfies CSSProperties,
  headerMain: { flex: 1 } satisfies CSSProperties,
  centerRow: { display: "flex", justifyContent: "center" } satisfies CSSProperties,
  skeletonRow: { marginBottom: 12 } satisfies CSSProperties,
} as const;

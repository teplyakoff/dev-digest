import type { CSSProperties } from "react";

/* Co-located styles for EvalDashboardView (design:
   `screen_skillslab_evaldashboard.jsx:406-424`). Objects only — nothing on this
   view varies by value, so no computed-style function is needed here. */

export const s = {
  page: { padding: "20px 28px 40px", maxWidth: 980, margin: "0 auto" } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-end",
    gap: 12,
    marginBottom: 18,
  } satisfies CSSProperties,
  headerText: { minWidth: 0 } satisfies CSSProperties,
  h1: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  model: {
    fontSize: 11.5,
    fontWeight: 500,
    color: "var(--text-muted)",
    padding: "2px 7px",
    borderRadius: 5,
    border: "1px solid var(--border)",
  } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", marginTop: 3 } satisfies CSSProperties,
  actions: {
    marginLeft: "auto",
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexShrink: 0,
  } satisfies CSSProperties,
  error: {
    fontSize: 12.5,
    color: "var(--crit)",
    marginTop: 10,
    lineHeight: 1.5,
  } satisfies CSSProperties,
} as const;

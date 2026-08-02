import type { CSSProperties } from "react";

/** Co-located styles for RunCostBadge. */
export const s = {
  empty: (large: boolean): CSSProperties => ({
    fontSize: large ? 13 : 12,
    color: "var(--text-muted)",
  }),
  badge: (large: boolean, muted: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: large ? 13 : 11.5,
    fontWeight: 500,
    color: muted ? "var(--text-muted)" : "var(--text-secondary)",
  }),
  tokens: {
    color: "var(--text-muted)",
    fontWeight: 400,
  } satisfies CSSProperties,
} as const;

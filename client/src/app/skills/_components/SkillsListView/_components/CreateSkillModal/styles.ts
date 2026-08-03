import type { CSSProperties } from "react";

/** Co-located styles for CreateSkillModal. */
export const s = {
  footer: { display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center" } satisfies CSSProperties,
  error: { marginRight: "auto", fontSize: 12.5, color: "var(--crit)" } satisfies CSSProperties,
  body: { padding: 24 } satisfies CSSProperties,
} as const;

import type { CSSProperties } from "react";

/** Co-located styles for HomeRedirectView (extracted from inline styles). */
export const s = {
  skeletonStack: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    maxWidth: 480,
  } satisfies CSSProperties,
  redirectNote: { color: "var(--text-secondary)", marginBottom: 14 } satisfies CSSProperties,
};

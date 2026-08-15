import type { CSSProperties } from "react";

export const s = {
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  } satisfies CSSProperties,

  /**
   * The PR Brief pair: Intent on the left, Blast radius on the right.
   *
   * The design specifies `1fr 1fr`. `auto-fit` with a floor keeps that on a wide
   * window and lets the two stack on a narrow one, rather than crushing a
   * file:line tree into half of a 900 px viewport.
   */
  briefGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
    gap: 16,
    alignItems: "start",
    marginBottom: 18,
  } satisfies CSSProperties,
} as const;

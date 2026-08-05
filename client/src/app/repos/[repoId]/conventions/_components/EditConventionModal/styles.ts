import type { CSSProperties } from "react";

/** Co-located styles for EditConventionModal. */
export const s = {
  footer: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  error: {
    fontSize: 12.5,
    color: "var(--danger)",
    marginRight: "auto",
  } satisfies CSSProperties,
  body: {
    padding: "18px 22px 8px",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
  /** The evidence is shown, never edited — same look as the card's snippet. */
  snippet: {
    margin: 0,
    padding: "10px 12px",
    fontSize: 11.5,
    lineHeight: 1.55,
    background: "var(--code-bg)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    overflow: "auto",
  } satisfies CSSProperties,
} as const;

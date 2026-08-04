import type { CSSProperties } from "react";
import type { ConventionStatus } from "@devdigest/shared";

/** Co-located styles for ConventionCard. Ported from the design's ConventionCard. */

/** The 3 px left border is the status: green accepted, grey pending, dim rejected. */
function accentFor(status: ConventionStatus): string {
  if (status === "accepted") return "var(--ok)";
  if (status === "rejected") return "var(--text-muted)";
  return "var(--border)";
}

export const s = {
  card: (status: ConventionStatus): CSSProperties => ({
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${accentFor(status)}`,
    borderRadius: 9,
    background: "var(--bg-elevated)",
    padding: 16,
    marginBottom: 12,
    // Rejected stays on screen, dimmed. Removing it would make an accidental
    // reject unrecoverable, and it is the one action with no confirmation.
    opacity: status === "rejected" ? 0.55 : 1,
    transition: "border-color .12s, opacity .12s",
  }),
  row: { display: "flex", gap: 14 } satisfies CSSProperties,
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  rule: {
    fontSize: 14,
    fontWeight: 600,
    fontStyle: "italic",
    lineHeight: 1.4,
  } satisfies CSSProperties,
  evidence: {
    marginTop: 10,
    borderRadius: 7,
    border: "1px solid var(--border)",
    overflow: "hidden",
  } satisfies CSSProperties,
  evidenceHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "5px 10px",
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  snippet: {
    margin: 0,
    padding: "10px 12px",
    fontSize: 11.5,
    lineHeight: 1.55,
    color: "var(--text-primary)",
    background: "var(--code-bg)",
    overflow: "auto",
  } satisfies CSSProperties,
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
  } satisfies CSSProperties,
  metaLabel: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  bar: { width: 90 } satisfies CSSProperties,
  percent: { fontSize: 11, color: "var(--text-secondary)" } satisfies CSSProperties,
  categoryPill: {
    fontSize: 10.5,
    fontWeight: 600,
    color: "var(--text-secondary)",
    background: "var(--bg-hover)",
    padding: "1px 7px",
    borderRadius: 4,
    marginLeft: "auto",
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
    flexShrink: 0,
    width: 150,
  } satisfies CSSProperties,
} as const;

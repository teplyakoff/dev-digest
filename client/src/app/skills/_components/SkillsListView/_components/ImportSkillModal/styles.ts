import type { CSSProperties } from "react";

/** Co-located styles for ImportSkillModal. */
export const s = {
  body: { padding: 24 } satisfies CSSProperties,
  hiddenInput: { display: "none" } satisfies CSSProperties,
  pickerIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  footer: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    justifyContent: "flex-end",
  } satisfies CSSProperties,
  footerNote: {
    marginRight: "auto",
    fontSize: 12,
    color: "var(--text-secondary)",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  error: { fontSize: 12.5, color: "var(--crit)", marginRight: "auto" } satisfies CSSProperties,

  picker: {
    display: "grid",
    placeItems: "center",
    gap: 12,
    padding: "40px 20px",
    border: "1px dashed var(--border-strong)",
    borderRadius: 10,
    background: "var(--bg-surface)",
    textAlign: "center",
  } satisfies CSSProperties,
  pickerHint: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,

  section: { marginBottom: 20 } satisfies CSSProperties,
  sectionTitle: {
    fontSize: 13,
    fontWeight: 700,
    marginBottom: 8,
    display: "flex",
    alignItems: "center",
    gap: 7,
  } satisfies CSSProperties,
  sectionBody: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    lineHeight: 1.5,
    marginBottom: 10,
  } satisfies CSSProperties,

  originGrid: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "6px 14px",
    fontSize: 12.5,
    alignItems: "baseline",
  } satisfies CSSProperties,
  originLabel: { color: "var(--text-muted)" } satisfies CSSProperties,

  ignoredList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 12,
  } satisfies CSSProperties,
  ignoredRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    fontSize: 12,
  } satisfies CSSProperties,
  ignoredPath: { flex: 1, minWidth: 0, wordBreak: "break-all" } satisfies CSSProperties,
  ignoredReason: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  ignoredNone: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,

  warning: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    background: "var(--warn-bg)",
    border: "1px solid var(--warn)",
    borderRadius: 8,
    padding: "10px 13px",
    marginBottom: 14,
  } satisfies CSSProperties,
} as const;

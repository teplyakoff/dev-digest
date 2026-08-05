import type { CSSProperties } from "react";

/** Co-located styles for SkillEditor and its tabs. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", minHeight: 0 } satisfies CSSProperties,
  tabsBar: { borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  body: { padding: 24 } satisfies CSSProperties,

  // ---- config tab ----
  form: { maxWidth: 760 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10, marginBottom: 18 } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  enabledLabel: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  actions: { display: "flex", gap: 8, marginTop: 8, alignItems: "center" } satisfies CSSProperties,
  snapshotHint: {
    marginLeft: "auto",
    fontSize: 11.5,
    color: "var(--text-muted)",
    alignSelf: "center",
  } satisfies CSSProperties,
  tokens: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,

  danger: {
    marginTop: 24,
    paddingTop: 18,
    borderTop: "1px solid var(--border)",
    display: "flex",
    alignItems: "center",
    gap: 12,
  } satisfies CSSProperties,
  dangerText: { flex: 1 } satisfies CSSProperties,
  dangerTitle: { fontSize: 13, fontWeight: 600, color: "var(--crit)" } satisfies CSSProperties,
  dangerBody: { fontSize: 12, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,

  // ---- preview tab ----
  previewWrap: { maxWidth: 720 } satisfies CSSProperties,
  previewSubtitle: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    margin: "4px 0 14px",
  } satisfies CSSProperties,
  previewCard: {
    fontSize: 13,
    color: "var(--text-secondary)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: "16px 18px",
  } satisfies CSSProperties,

  // ---- stats tab ----
  statsWrap: { maxWidth: 720 } satisfies CSSProperties,
  statsSubtitle: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    margin: "4px 0 16px",
  } satisfies CSSProperties,
  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 12,
    marginBottom: 20,
  } satisfies CSSProperties,
  statTile: {
    padding: 15,
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  statLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.03em",
  } satisfies CSSProperties,
  statValue: { fontSize: 22, fontWeight: 700, marginTop: 8 } satisfies CSSProperties,
  statSuffix: {
    fontSize: 12,
    fontWeight: 500,
    color: "var(--text-muted)",
    marginLeft: 4,
  } satisfies CSSProperties,
  agentList: { display: "flex", flexDirection: "column", gap: 8, marginTop: 10 } satisfies CSSProperties,
  agentRow: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    padding: "8px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  agentIcon: {
    width: 22,
    height: 22,
    borderRadius: 6,
    background: "var(--accent-bg)",
    color: "var(--accent)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  } satisfies CSSProperties,
  agentName: { fontSize: 12.5, fontWeight: 600, flex: 1 } satisfies CSSProperties,
  statsFootnote: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    marginTop: 18,
    paddingTop: 12,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,

  // ---- versions tab ----
  versionsWrap: { maxWidth: 720 } satisfies CSSProperties,
  versionsHead: { display: "flex", alignItems: "center", gap: 10, marginBottom: 4 } satisfies CSSProperties,
  versionsSubtitle: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    marginBottom: 16,
  } satisfies CSSProperties,
  versionList: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  versionRow: (current: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid " + (current ? "var(--border-strong)" : "var(--border)"),
    background: "var(--bg-elevated)",
  }),
  versionTag: (current: boolean): CSSProperties => ({
    fontSize: 12.5,
    fontWeight: 700,
    color: current ? "var(--accent-text)" : "var(--text-secondary)",
    background: current ? "var(--accent-bg)" : "var(--bg-hover)",
    padding: "3px 9px",
    borderRadius: 6,
    flexShrink: 0,
  }),
  versionMeta: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  versionDate: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  versionExcerpt: {
    fontSize: 12,
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
} as const;

import type { Severity, FindingCategory } from "@devdigest/shared";

/**
 * The slice of a finding the counters and their popup need. Structural on
 * purpose: both `PrListFinding` (PR-list payload) and `FindingRecord`
 * (reviews payload) satisfy it, which is what lets the Agent Runs timeline
 * reuse the component on data the page already fetched.
 */
export interface SlimFinding {
  severity: Severity;
  category: FindingCategory;
  title: string;
  file: string;
  start_line: number;
  end_line: number;
  confidence: number;
  rationale: string;
}

export type SeverityCounts = Record<"CRITICAL" | "WARNING" | "SUGGESTION", number>;

/** Chip order — and the popup's sort order. */
export const COUNTED_SEVERITIES = ["CRITICAL", "WARNING", "SUGGESTION"] as const;

/**
 * Zero-seeded so a clean review yields real zeros, never missing keys —
 * the client twin of the server's aggregation helper. Severities outside the
 * three counted ones (INFO can exist in UI types) are counted nowhere.
 */
export function countBySeverity(findings: ReadonlyArray<{ severity: string }>): SeverityCounts {
  const counts: SeverityCounts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) {
    if (f.severity in counts) counts[f.severity as keyof SeverityCounts] += 1;
  }
  return counts;
}

export function hasAnyCount(counts: SeverityCounts): boolean {
  return COUNTED_SEVERITIES.some((sv) => counts[sv] > 0);
}

/** CRITICAL → WARNING → SUGGESTION; stable within a severity. */
export function sortBySeverity<T extends { severity: string }>(findings: readonly T[]): T[] {
  const order = new Map(COUNTED_SEVERITIES.map((sv, i) => [sv as string, i]));
  return [...findings].sort(
    (a, b) => (order.get(a.severity) ?? COUNTED_SEVERITIES.length) - (order.get(b.severity) ?? COUNTED_SEVERITIES.length),
  );
}

/** `src/a.ts:11` — a same-line range collapses to a single number. */
export function formatLineRef(f: Pick<SlimFinding, "file" | "start_line" | "end_line">): string {
  const range = f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
  return `${f.file}:${range}`;
}

/** Rationales are markdown; the popup shows them as plain two-line text. */
export function stripMd(text: string | null | undefined): string {
  return (text ?? "").replace(/\*\*|`/g, "");
}

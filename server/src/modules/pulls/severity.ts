import type { PrMeta } from '@devdigest/shared';

type SeverityCounts = NonNullable<PrMeta['findings_by_severity']>;

/**
 * Zero-seeded so a clean review yields real zeros, never missing keys —
 * the list's null-vs-zero rule (docs/specs/02-severity-counters.md) depends
 * on it. Unknown severity strings are counted nowhere.
 */
export function countBySeverity(rows: ReadonlyArray<{ severity: string }>): SeverityCounts {
  const counts: SeverityCounts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const row of rows) {
    if (row.severity in counts) counts[row.severity as keyof SeverityCounts] += 1;
  }
  return counts;
}

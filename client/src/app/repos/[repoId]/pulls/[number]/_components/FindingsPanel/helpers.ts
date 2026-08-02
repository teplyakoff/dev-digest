import type { FindingRecord } from "@devdigest/shared";
import {
  LOW_CONFIDENCE_THRESHOLD,
  SEVERITY_ORDER,
  type FilterableSeverity,
  type SevFilter,
} from "./constants";

/**
 * Severity toggles first (severities outside the filterable three — INFO —
 * are never hidden), then the low-confidence filter, then the severity sort.
 */
export function visibleFindings(
  findings: FindingRecord[],
  opts: { hideLow: boolean; severities: SevFilter },
): FindingRecord[] {
  let shown = findings.filter(
    (f) => opts.severities[f.severity as FilterableSeverity] ?? true,
  );
  if (opts.hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}

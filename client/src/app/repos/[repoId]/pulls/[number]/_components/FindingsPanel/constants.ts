import type { FindingActionKind } from "@devdigest/shared";

/** Sort weight per severity (lower = shown first). */
export const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
  INFO: 3,
};

/** Confidence below this is hidden when "hide low confidence" is on. */
export const LOW_CONFIDENCE_THRESHOLD = 0.65;

/** The severities the filter chips cover. INFO is not filterable — never hidden. */
export const FILTERABLE_SEVERITIES = ["CRITICAL", "WARNING", "SUGGESTION"] as const;
export type FilterableSeverity = (typeof FILTERABLE_SEVERITIES)[number];
export type SevFilter = Record<FilterableSeverity, boolean>;

/** Default filter state: every severity visible; each chip toggles its own. */
export const ALL_SEVERITIES_ON: SevFilter = { CRITICAL: true, WARNING: true, SUGGESTION: true };

/** Keyboard shortcut → finding action. */
export const KEY_TO_ACTION: Record<string, FindingActionKind> = {
  a: "accept",
  d: "dismiss",
};

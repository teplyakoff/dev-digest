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

/**
 * How long the `?finding=<id>` scroll may keep waiting for its row to appear,
 * in milliseconds of wall clock, before it gives up watching.
 *
 * This replaces a frame budget, which was the wrong instrument. The wait is not
 * paced by rendering at all: the row arrives when the query resolves, the
 * accordion opens and the panel mounts. Measured in the live app on a real
 * imported PR (1400x900, clicking a Smart Diff finding tag): the deep-linked
 * card first entered the DOM **791 ms after the click** — ~47 frames at 60 Hz —
 * while the previous 20-frame budget expired at ~330 ms, ~460 ms too early, with
 * `scrollIntoView` never called once. Any fixed frame count is either short like
 * that one or a guess pinned to one machine and one PR, so the row is now
 * watched for with a `MutationObserver` and this value is only the ceiling.
 *
 * 8 s is ~10x the measured 791 ms: generous enough for a cold query on a slow
 * connection, and still bounded, because a lookup that will never succeed must
 * stop rather than keep an observer alive for the life of the page.
 */
export const FOCUS_SCROLL_TIMEOUT_MS = 8_000;

/** Keyboard shortcut → finding action. */
export const KEY_TO_ACTION: Record<string, FindingActionKind> = {
  a: "accept",
  d: "dismiss",
};

import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `skills` namespace. */
export interface SkillEditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/**
 * Config / Preview / Versions / Stats.
 *
 * Stats used to be excluded alongside Evals on the grounds that it "depends on
 * machinery later lessons build". That was half right: the design's tab wants
 * pull-frequency and accept-rate, which really do need telemetry nobody has
 * built. But usage and token cost are already persisted on every run trace, and
 * a skill's cost is the one thing L02 promised to show. So the tab ships with
 * the numbers that exist and none of the ones that don't.
 *
 * Evals remains out — there are no eval runs to report on at all.
 */
export const TABS: readonly SkillEditorTab[] = [
  { key: "config", labelKey: "detail.tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "detail.tabs.preview", icon: "Eye" },
  { key: "versions", labelKey: "detail.tabs.versions", icon: "History" },
  { key: "stats", labelKey: "detail.tabs.stats", icon: "BarChart" },
];

export const VALID_TABS = TABS.map((t) => t.key);

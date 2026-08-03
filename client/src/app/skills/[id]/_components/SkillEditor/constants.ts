import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `skills` namespace. */
export interface SkillEditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/**
 * L02 ships Config / Preview / Versions. The design also has Evals and Stats;
 * both depend on machinery later lessons build (eval runs, pull/accept
 * telemetry), so they are left out rather than stubbed.
 */
export const TABS: readonly SkillEditorTab[] = [
  { key: "config", labelKey: "detail.tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "detail.tabs.preview", icon: "Eye" },
  { key: "versions", labelKey: "detail.tabs.versions", icon: "History" },
];

export const VALID_TABS = TABS.map((t) => t.key);

/** Rough token estimate for the editor header — chars/4, the same heuristic the
 *  server's tokenizer falls back to. The authoritative per-skill count comes
 *  from the run trace, which counts the rendered block with a real encoder. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

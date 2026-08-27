import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Editor tabs. L02 adds Skills; L06 adds Evals; Stats/CI come with later lessons. */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
  { key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" },
];

/**
 * Tabs the `?tab=` param may select. Kept beside TABS because the page's
 * fallback is SILENT — an unlisted key renders Config and ignores the URL, which
 * looks like a working page rather than a missing entry.
 */
export const VALID_TABS = TABS.map((t) => t.key);

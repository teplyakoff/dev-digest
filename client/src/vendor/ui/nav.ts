/* nav.ts — sidebar nav groups + keyboard shortcut registry.
   hrefs use :repoId token; the web app fills it from the active repo. */
import type { IconName } from "./icons";

export interface NavItemDef {
  key: string;
  label: string;
  icon: IconName;
  /** Route template; :repoId is replaced with the active repo id by the app. */
  href: string;
  /** Optional g-nav shortcut suffix (e.g. "p" → g then p). */
  gKey?: string;
  badge?: string;
}

export interface NavGroup {
  section: string;
  items: NavItemDef[];
}

/**
 * Two sections, as the design's `chrome.jsx` has them: WORKSPACE is what you do
 * to a repo's pull requests, SKILLS LAB is the knowledge layer you author once
 * and reuse across them. The split is not decoration — the breadcrumbs on both
 * `/skills` and `/agents` already say "Skills Lab", so a single flat section
 * contradicted the pages it linked to.
 *
 * Item ORDER inside SKILLS LAB follows the design too: Skills, then Agents (what
 * loads them), then Conventions (where the first ones come from).
 */
export const NAV: NavGroup[] = [
  {
    section: "WORKSPACE",
    items: [
      { key: "pulls", label: "Pull Requests", icon: "GitPullRequest", href: "/repos/:repoId/pulls", gKey: "p" },
      // L06 — Project Context sits second in WORKSPACE, after Pull Requests, as
      // the design has it. The design's neighbours (`dashboard`,
      // `onboarding-tour`) do not exist here, so the POSITION is carried by
      // meaning rather than by index.
      //
      // NO `gKey`, and therefore no SHORTCUTS row: the design item carries key,
      // label and icon only, and assigning a letter here would be inventing a
      // requirement nobody stated. `nav-registry.test.ts` pins the absence so it
      // reads as a decision rather than an omission.
      { key: "context", label: "Project Context", icon: "Folder", href: "/repos/:repoId/context" },
    ],
  },
  {
    section: "SKILLS LAB",
    items: [
      { key: "skills", label: "Skills", icon: "Sparkles", href: "/skills", gKey: "s" },
      { key: "agents", label: "Agents", icon: "Cpu", href: "/agents", gKey: "a" },
      // L06 — the Eval Dashboard sits directly after Agents: evals measure
      // agents, and this section's order is meaning-carried.
      //
      // NO `gKey`, and therefore no SHORTCUTS row, exactly as `context` above:
      // a letter chosen here would be inventing a requirement nobody stated,
      // and `nav-registry.test.ts` pins the absence so it reads as a decision.
      //
      // The key is `eval`, not `evals`, because `activeKeyFor`
      // (`src/components/app-shell/helpers.ts`) maps every `/eval*` pathname to
      // `"eval"` — a key that does not match leaves the sidebar item unlit on
      // its own page. The design's `chrome.jsx` uses `eval` too.
      //
      // The href matches the key: `/eval` lands on the dashboard, which then
      // replaces the URL with `/eval/:agentId`. `/evals` still resolves — it
      // redirects here — but the sidebar points at the canonical spelling.
      { key: "eval", label: "Eval Dashboard", icon: "FlaskConical", href: "/eval" },
      { key: "conventions", label: "Conventions", icon: "ListChecks", href: "/repos/:repoId/conventions", gKey: "c" },
    ],
  },
];

export const SETTINGS_ITEM: NavItemDef = {
  key: "settings",
  label: "Settings",
  icon: "Settings",
  href: "/settings/api-keys",
  gKey: ",",
};

export const SETTINGS_SECTIONS = [
  { key: "api-keys", label: "API Keys" },
  { key: "models", label: "Feature Models" },
] as const;

/** Keyboard shortcut registry. Wiring is finalized by A6. */
export interface ShortcutDef {
  keys: string;
  label: string;
  group: "Navigation" | "Findings" | "Actions" | "Global";
}

export const SHORTCUTS: ShortcutDef[] = [
  { keys: "⌘K", label: "Open command palette", group: "Global" },
  { keys: "?", label: "Show keyboard shortcuts", group: "Global" },
  { keys: "g p", label: "Go to Pull Requests", group: "Navigation" },
  { keys: "g s", label: "Go to Skills", group: "Navigation" },
  { keys: "g c", label: "Go to Conventions", group: "Navigation" },
  { keys: "g a", label: "Go to Agents", group: "Navigation" },
  { keys: "j / k", label: "Next / previous finding", group: "Findings" },
  { keys: "a", label: "Accept finding", group: "Findings" },
  { keys: "d", label: "Dismiss finding", group: "Findings" },
];

/** Resolve an :repoId-templated href against the active repo id. */
export function resolveHref(href: string, repoId: string | null | undefined): string {
  if (!href.includes(":repoId")) return href;
  return href.replace(":repoId", repoId ?? "_");
}

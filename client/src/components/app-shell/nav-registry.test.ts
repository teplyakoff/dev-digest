import { describe, it, expect } from "vitest";
import { NAV, SETTINGS_ITEM, SHORTCUTS, resolveHref } from "@devdigest/ui";

/**
 * The sidebar nav registry, pinned from app code.
 *
 * WHY THIS FILE EXISTS. `NAV` lives in `src/vendor/ui/nav.ts`, which both
 * AGENTS.md files mark "do not touch — edit the source, then re-vendor". For
 * `vendor/shared` that instruction is followable: the source is
 * `server/src/vendor/shared`, `scripts/vendor-shared.sh` copies it, and CI fails
 * on drift. For `vendor/ui` there is no source, no script, no gate, and no
 * upstream — `git log` shows a single commit, the initial snapshot. So the rule
 * cannot be complied with, and the route registration for `/skills` has to be
 * made there.
 *
 * What the pre-PR review flagged was not the edit but its silence: nothing would
 * ever tell you the entry had been dropped. These assertions are that alarm. If
 * `nav.ts` is ever replaced wholesale, this test fails naming the missing route
 * rather than the app quietly losing a page from its sidebar, its command
 * palette, and its `g`-key shortcuts — all three read this registry.
 */

const items = NAV.flatMap((group) => group.items);
const byKey = (key: string) => items.find((i) => i.key === key);
const sectionOf = (key: string) => NAV.find((g) => g.items.some((i) => i.key === key))?.section;

describe("nav registry — every shipped route is registered", () => {
  it.each([
    ["pulls", "/repos/:repoId/pulls", "p"],
    ["skills", "/skills", "s"],
    ["conventions", "/repos/:repoId/conventions", "c"],
    ["agents", "/agents", "a"],
  ])("%s → %s (g %s)", (key, href, gKey) => {
    const item = byKey(key);
    expect(item, `nav entry "${key}" is missing from NAV`).toBeDefined();
    expect(item!.href).toBe(href);
    expect(item!.gKey).toBe(gKey);
  });

  // The sidebar renders one header per group, so which group an item sits in is
  // user-visible grouping, not an implementation detail. Pinned because the
  // knowledge-layer pages drifted into WORKSPACE once already, while their own
  // breadcrumbs read "Skills Lab".
  it.each([
    ["pulls", "WORKSPACE"],
    ["skills", "SKILLS LAB"],
    ["agents", "SKILLS LAB"],
    ["conventions", "SKILLS LAB"],
  ])("%s lives under %s", (key, section) => {
    expect(sectionOf(key), `nav entry "${key}" is in the wrong section`).toBe(section);
  });

  it("keeps the sections distinct and in design order", () => {
    expect(NAV.map((g) => g.section)).toEqual(["WORKSPACE", "SKILLS LAB"]);
  });

  it("gives every item a distinct g-key, so no shortcut shadows another", () => {
    const keys = [...items, SETTINGS_ITEM].map((i) => i.gKey).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("documents each g-key in SHORTCUTS, which is what the ? overlay renders", () => {
    // A registered shortcut that isn't in SHORTCUTS works but is undiscoverable.
    for (const item of items) {
      if (!item.gKey) continue;
      expect(
        SHORTCUTS.some((s) => s.keys === `g ${item.gKey}`),
        `g ${item.gKey} (${item.key}) is missing from SHORTCUTS`,
      ).toBe(true);
    }
  });

  it("resolves :repoId only where the route actually has one", () => {
    expect(resolveHref(byKey("skills")!.href, "repo-1")).toBe("/skills");
    expect(resolveHref(byKey("pulls")!.href, "repo-1")).toBe("/repos/repo-1/pulls");
    expect(resolveHref(byKey("conventions")!.href, "repo-1")).toBe("/repos/repo-1/conventions");
    // No active repo → the placeholder, not a broken "/repos/null/pulls".
    expect(resolveHref(byKey("pulls")!.href, null)).toBe("/repos/_/pulls");
  });
});

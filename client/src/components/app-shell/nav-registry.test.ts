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

  // Project Context (L06) is the one entry with NO g-key, so it cannot ride the
  // table above. Its absence is pinned rather than assumed: the design item
  // carries key, label and icon only, and a letter chosen here would be a
  // requirement nobody wrote down. If one is ever assigned, this test fails and
  // the SHORTCUTS row has to be added with it.
  it("context → /repos/:repoId/context, deliberately without a g-key", () => {
    const item = byKey("context");
    expect(item, 'nav entry "context" is missing from NAV').toBeDefined();
    expect(item!.href).toBe("/repos/:repoId/context");
    expect(item!.label).toBe("Project Context");
    expect(item!.gKey).toBeUndefined();
  });

  /**
   * SPEC-08 AC-84 — the Eval Dashboard entry, pinned here rather than where it
   * is written, because `nav.ts` is a frozen vendored file whose one sanctioned
   * edit has to be alarmed from app code (root CLAUDE.md).
   *
   * THE KEY IS `eval`, NOT `evals`, AND THE HREF IS `/evals`. They differ on
   * purpose: `activeKeyFor` folds every `/eval*` pathname onto the single key
   * `eval`, so a key spelled to match the URL would leave the sidebar item
   * unlit on the very page it points at — a defect that is invisible in a diff
   * and easy to "fix" the wrong way round. Both halves are asserted so neither
   * can be tidied into the other.
   */
  it("eval → /evals under the key `eval`, deliberately without a g-key", () => {
    const item = byKey("eval");
    expect(item, 'nav entry "eval" is missing from NAV').toBeDefined();
    expect(item!.href).toBe("/evals");
    expect(item!.label).toBe("Eval Dashboard");
    // Following the `context` precedent above: no letter was specified, so
    // none is invented. Pinning the ABSENCE is what stops someone adding a
    // colliding one without noticing this decision was made.
    expect(item!.gKey).toBeUndefined();
    // …and there is no orphan SHORTCUTS row advertising a key that does not
    // exist. `byKey("evals")` returning undefined is the other half of the same
    // claim: the misspelling must not be what got registered.
    expect(byKey("evals")).toBeUndefined();
  });

  // The `?` overlay is generated from SHORTCUTS, so a row added for an entry
  // with no gKey would document a shortcut that does nothing. The list is
  // pinned whole rather than by absence of one string: an added row anywhere
  // fails this, which is the point.
  it("leaves SHORTCUTS unchanged — the eval entry adds no g-key row", () => {
    expect(SHORTCUTS.map((s) => s.keys)).toEqual([
      "⌘K",
      "?",
      "g p",
      "g s",
      "g c",
      "g a",
      "j / k",
      "a",
      "d",
    ]);
  });

  // Position, not just membership. The design puts Project Context directly
  // after Pull Requests, and "it is somewhere in WORKSPACE" is a weaker claim
  // that a reshuffle would satisfy.
  it("places context second in WORKSPACE, right after Pull Requests", () => {
    const workspace = NAV.find((g) => g.section === "WORKSPACE")!;
    expect(workspace.items.map((i) => i.key)).toEqual(["pulls", "context"]);
  });

  // The sidebar renders one header per group, so which group an item sits in is
  // user-visible grouping, not an implementation detail. Pinned because the
  // knowledge-layer pages drifted into WORKSPACE once already, while their own
  // breadcrumbs read "Skills Lab".
  it.each([
    ["pulls", "WORKSPACE"],
    ["context", "WORKSPACE"],
    ["skills", "SKILLS LAB"],
    ["agents", "SKILLS LAB"],
    ["eval", "SKILLS LAB"],
    ["conventions", "SKILLS LAB"],
  ])("%s lives under %s", (key, section) => {
    expect(sectionOf(key), `nav entry "${key}" is in the wrong section`).toBe(section);
  });

  // AC-84's position half. Membership alone would be satisfied by an entry
  // appended after Conventions; the design puts evals directly after the thing
  // they measure.
  it("places eval third in SKILLS LAB, right after Agents", () => {
    const lab = NAV.find((g) => g.section === "SKILLS LAB")!;
    expect(lab.items.map((i) => i.key)).toEqual(["skills", "agents", "eval", "conventions"]);
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
    expect(resolveHref(byKey("context")!.href, "repo-1")).toBe("/repos/repo-1/context");
    // No active repo → the placeholder, not a broken "/repos/null/pulls".
    expect(resolveHref(byKey("pulls")!.href, null)).toBe("/repos/_/pulls");
  });
});

import { describe, it, expect } from "vitest";
import type { AgentSkillLink, Skill } from "@devdigest/shared";
import { filterRows, moveId, orderRows, toggleLink } from "./helpers";

/**
 * The ordering rules behind the agent's Skills tab. These are the reason the tab
 * exists — the row order IS the order the blocks appear in the assembled prompt
 * — so they are tested directly rather than through the DOM.
 */

const skill = (id: string, name: string, over: Partial<Skill> = {}): Skill => ({
  id,
  name,
  description: `${name} description`,
  type: "rubric",
  source: "manual",
  body: "body",
  enabled: true,
  version: 1,
  evidence_files: null,
  ...over,
});

const A = skill("a", "alpha-rule");
const B = skill("b", "beta-rule", { type: "security" });
const C = skill("c", "gamma-rule");

const link = (skill_id: string, order: number): AgentSkillLink => ({
  agent_id: "ag1",
  skill_id,
  order,
});

describe("orderRows", () => {
  it("puts linked skills first in link order, then unlinked ones by name", () => {
    // The linked set must read top-to-bottom exactly as the prompt will; the
    // unlinked remainder is a menu, and a menu sorts alphabetically.
    const rows = orderRows([A, B, C], [link("c", 0), link("a", 1)]);
    expect(rows.map((r) => r.skill.id)).toEqual(["c", "a", "b"]);
    expect(rows.map((r) => r.linked)).toEqual([true, true, false]);
  });

  it("respects order values that are not 0..n-1", () => {
    // `order` comes from the server and is only guaranteed ascending.
    const rows = orderRows([A, B], [link("b", 5), link("a", 40)]);
    expect(rows.map((r) => r.skill.id)).toEqual(["b", "a"]);
  });

  it("lists every workspace skill even when the agent links none", () => {
    // Attaching is the primary action here, so the unattached ones must be visible.
    const rows = orderRows([C, A, B], []);
    expect(rows.map((r) => r.skill.id)).toEqual(["a", "b", "c"]);
    expect(rows.every((r) => !r.linked)).toBe(true);
  });

  it("ignores a link whose skill is gone", () => {
    const rows = orderRows([A], [link("a", 0), link("deleted", 1)]);
    expect(rows.map((r) => r.skill.id)).toEqual(["a"]);
  });
});

describe("toggleLink", () => {
  it("appends a newly attached skill at the end", () => {
    // New skills go last: inserting one into the middle would silently reorder
    // the prompt blocks a user already arranged.
    expect(toggleLink(["a", "b"], "c")).toEqual(["a", "b", "c"]);
  });

  it("removes an attached skill and keeps the rest in order", () => {
    expect(toggleLink(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});

describe("moveId", () => {
  it("moves an item forward and backward", () => {
    expect(moveId(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveId(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it.each([
    ["same index", 1, 1],
    ["negative source", -1, 0],
    ["out-of-range target", 0, 9],
  ])("returns the list unchanged for %s", (_label, from, to) => {
    const ids = ["a", "b", "c"];
    expect(moveId(ids, from, to)).toEqual(ids);
  });
});

describe("filterRows", () => {
  it("matches name and type", () => {
    const rows = orderRows([A, B, C], []);
    expect(filterRows(rows, "beta").map((r) => r.skill.id)).toEqual(["b"]);
    expect(filterRows(rows, "SECURITY").map((r) => r.skill.id)).toEqual(["b"]);
    expect(filterRows(rows, "")).toHaveLength(3);
  });
});

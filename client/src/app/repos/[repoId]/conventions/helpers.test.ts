import { describe, it, expect } from "vitest";
import type { ConventionCandidate } from "@devdigest/shared";
import { acceptedCount, bulkAction, dropSummary, evidenceLabel, evidenceUrl } from "./helpers";

/**
 * Pure helpers for the Conventions page.
 *
 * `bulkAction` is here because of a bug the demo recording caught: "Accept all"
 * swept a candidate the user had explicitly REJECTED back into the accepted set,
 * and it ended up in the generated skill — defeating the one claim the feature
 * is judged on.
 */

function candidate(over: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id: "c1",
    category: "naming",
    rule: "Files are kebab-case",
    evidence_path: "src/a.ts",
    evidence_start_line: 3,
    evidence_end_line: 6,
    evidence_snippet: "const a = 1;",
    confidence: 0.9,
    status: "pending",
    skill_id: null,
    ...over,
  };
}

describe("bulkAction — Accept all", () => {
  it("accepts the undecided ones", () => {
    const list = [candidate({ id: "a" }), candidate({ id: "b" })];
    expect(bulkAction(list, false)).toEqual({ ids: ["a", "b"], status: "accepted" });
  });

  it("does NOT revive a candidate the user rejected", () => {
    // The whole point: a convenience button must not overturn an explicit
    // decision. A rejected candidate comes back one at a time, via its Undo.
    const list = [candidate({ id: "a" }), candidate({ id: "b", status: "rejected" })];
    expect(bulkAction(list, false)).toEqual({ ids: ["a"], status: "accepted" });
  });

  it("re-accepting an already-accepted one is harmless", () => {
    const list = [candidate({ id: "a", status: "accepted" }), candidate({ id: "b" })];
    expect(bulkAction(list, false).ids).toEqual(["a", "b"]);
  });
});

describe("bulkAction — Deselect all", () => {
  it("clears the accepted ones and leaves rejections standing", () => {
    const list = [
      candidate({ id: "a", status: "accepted" }),
      candidate({ id: "b", status: "rejected" }),
    ];
    expect(bulkAction(list, true)).toEqual({ ids: ["a"], status: "pending" });
  });
});

describe("acceptedCount", () => {
  it("counts only accepted", () => {
    expect(
      acceptedCount([
        candidate({ status: "accepted" }),
        candidate({ status: "rejected" }),
        candidate({ status: "pending" }),
      ]),
    ).toBe(1);
  });
});

describe("evidenceLabel", () => {
  it("collapses a one-line span", () => {
    expect(evidenceLabel(candidate({ evidence_start_line: 3, evidence_end_line: 3 }))).toBe("src/a.ts:3");
  });
  it("keeps a range", () => {
    expect(evidenceLabel(candidate())).toBe("src/a.ts:3-6");
  });
});

describe("evidenceUrl", () => {
  const scan = {
    indexed_sha: "abc1234",
    id: "s",
    repo_id: "r",
    sampled_files: [],
    config_files: [],
    proposed: 1,
    kept: 1,
    dropped: [],
    provider: "openrouter" as const,
    model: "m",
    tokens_in: 1,
    tokens_out: 1,
    cost_usd: 0,
    created_at: "2026-08-04T00:00:00Z",
  };

  it("pins to the scanned SHA, not a branch", () => {
    expect(evidenceUrl(candidate(), scan, "acme/app")).toBe(
      "https://github.com/acme/app/blob/abc1234/src/a.ts#L3-L6",
    );
  });

  it("returns null rather than a broken link when a piece is missing", () => {
    expect(evidenceUrl(candidate(), null, "acme/app")).toBeNull();
    expect(evidenceUrl(candidate(), scan, null)).toBeNull();
  });
});

describe("dropSummary", () => {
  it("counts reasons, most casualties first", () => {
    expect(
      dropSummary({
        ...{ indexed_sha: "x", id: "s", repo_id: "r", sampled_files: [], config_files: [], proposed: 4, kept: 1, provider: "openrouter" as const, model: "m", tokens_in: 1, tokens_out: 1, cost_usd: 0, created_at: "x" },
        dropped: [
          { rule: "a", reason: "duplicate_rule" as const },
          { rule: "b", reason: "file_not_sampled" as const },
          { rule: "c", reason: "duplicate_rule" as const },
        ],
      }),
    ).toEqual(["duplicate_rule × 2", "file_not_sampled × 1"]);
  });
});

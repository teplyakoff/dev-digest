import { describe, it, expect } from "vitest";
import messages from "../../../../../messages/en/context.json";

/**
 * AC-27 — the copy has to describe the store that was built.
 *
 * The empty state used to read: "Drop your PRDs, tech specs, and acceptance
 * criteria under `.devdigest/specs/`. Every agent and the PR brief read them as
 * grounding context." Both halves were false. No such path exists — the store is
 * a database table, because a clone is resynced with `git reset --hard` and a
 * file written there is deleted without a word. And nothing is read
 * automatically: an agent sees a document only once somebody attaches it.
 *
 * A left-over old copy is not cosmetic. It instructs the next reader to restore
 * behaviour nobody built, and the reader who follows it will conclude the
 * feature is broken rather than that the sentence is.
 */

/** Every string in the namespace, flattened, so a nested key cannot hide. */
function allStrings(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (node && typeof node === "object") return Object.values(node).flatMap(allStrings);
  return [];
}

const strings = allStrings(messages);

describe("context messages", () => {
  it("names no filesystem path the store does not have", () => {
    for (const value of strings) {
      expect(value).not.toContain(".devdigest/specs");
      expect(value).not.toContain(".devdigest");
    }
  });

  it("does not promise that documents are read automatically", () => {
    // The claim, not the wording: the empty state must not say every agent reads
    // these, because attachment is explicit and per-agent.
    expect(messages.empty.body).not.toMatch(/every agent/i);
    expect(messages.empty.body).toMatch(/attach/i);
  });

  it("wires the three strings the editor and mode switch actually use", () => {
    // Dormant since the starter shipped. If any of these is missing the editor
    // renders an untranslated key, which reads as a broken build.
    expect(messages.mode.preview).toBeTruthy();
    expect(messages.mode.edit).toBeTruthy();
    expect(messages.editor.save).toBeTruthy();
    expect(messages.editor.saving).toBeTruthy();
  });

  it("keeps `chunks` and `indexStatus` dormant rather than deleting them", () => {
    // Chunking is a deliberate non-goal, not an oversight: `code_chunks` stays
    // empty and these keys stay unused. Removing them is a different change.
    expect(messages.chunks).toBeTruthy();
    expect(messages.indexStatus).toBeTruthy();
  });

  it("gives every counted noun an explicit ICU plural arm", () => {
    // `"{count} docs"` renders "1 docs" and nothing type-checks it. Any string
    // that interpolates a count has to select on it.
    for (const value of strings) {
      if (!value.includes("{count}") && !value.includes("{docs}")) continue;
      expect(value, `"${value}" interpolates a count without a plural arm`).toMatch(/plural/);
    }
  });
});

// NOTE — `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
// dependency of this package and every existing test here uses `fireEvent`
// (client/INSIGHTS.md, "Codebase Patterns").
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseRecord, EvalCaseUpsertBody } from "@devdigest/shared";
import eval_ from "../../../../messages/en/eval.json";
import common from "../../../../messages/en/common.json";

/**
 * The two mutations are stubbed, and this is the one place in this feature's
 * tests where that is the right call: what the editor is graded on is the BODY
 * it composes — the derived expectation, the parsed expected output, the
 * deliberately-null `input_files` — and the only way to read that body is at the
 * boundary it hands it to. The assertions below are on the recorded ARGUMENT,
 * never on a call count.
 */
const createMutate = vi.fn();
const updateMutate = vi.fn();

vi.mock("@/lib/hooks/evals", () => ({
  useCreateEvalCase: () => ({ mutateAsync: createMutate, isPending: false, error: null }),
  useUpdateEvalCase: () => ({ mutateAsync: updateMutate, isPending: false, error: null }),
}));

import { EvalCaseEditor } from "./EvalCaseEditor";

beforeEach(() => {
  createMutate.mockReset();
  updateMutate.mockReset();
  createMutate.mockResolvedValue({ id: "case-1", owner_id: "agent-1" });
  updateMutate.mockResolvedValue({ id: "case-1", owner_id: "agent-1" });
});

afterEach(cleanup);

function evalCase(o: Partial<EvalCaseRecord> = {}): EvalCaseRecord {
  return {
    id: "case-1",
    owner_kind: "agent",
    owner_id: "agent-1",
    name: "hardcoded-secret",
    input_diff: "@@ -10,6 +10,7 @@\n+  stripeKey: 'sk_live_x'",
    input_files: null,
    input_meta: { title: "Add Stripe", body: "Wire up payments." },
    expected_output: [{ file: "src/config.ts", start_line: 11, end_line: 11 }],
    notes: null,
    expectation: "must_find",
    source_finding_id: "f1",
    ...o,
  };
}

function renderEditor(props: Partial<React.ComponentProps<typeof EvalCaseEditor>> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const view = render(
    <NextIntlClientProvider locale="en" messages={{ eval: eval_, common }}>
      <EvalCaseEditor agentId="agent-1" onClose={onClose} {...props} />
    </NextIntlClientProvider>,
  );
  return { ...view, onClose };
}

/** The expected-output box: labelled by a wrapping `<label>` with hidden text. */
const expectedBox = () => screen.getByLabelText(eval_.caseEditor.expectedOutput);
const diffBox = () => screen.getByLabelText(eval_.caseEditor.tabs.diff);
const nameBox = () => screen.getByLabelText(eval_.caseEditor.nameLabel);
const saveButton = () => screen.getByRole("button", { name: eval_.caseEditor.save });

/** The last body handed to a mutation — what the editor actually composed. */
const lastCreateBody = () => createMutate.mock.calls.at(-1)![0] as EvalCaseUpsertBody;

describe("EvalCaseEditor — exactly two input tabs (AC-98)", () => {
  it("offers Diff and PR meta, and no Files tab", () => {
    renderEditor();

    expect(screen.getByRole("button", { name: eval_.caseEditor.tabs.diff })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: eval_.caseEditor.tabs.prMeta })).toBeInTheDocument();
    // The design draws a third tab; the shipped i18n bundle has two and the
    // bundle wins, because `input_files` has no editor and stays null. A ported
    // third tab would offer a control that writes nowhere.
    expect(screen.queryByRole("button", { name: /files/i })).not.toBeInTheDocument();
  });

  it("switches to the PR-meta fields and back", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: eval_.caseEditor.tabs.prMeta }));
    expect(screen.getByLabelText(eval_.caseEditor.titleLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(eval_.caseEditor.bodyLabel)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: eval_.caseEditor.tabs.diff }));
    expect(diffBox()).toBeInTheDocument();
  });
});

describe("EvalCaseEditor — the JSON validity badge (AC-99)", () => {
  it("flips from valid to invalid as the expected output is edited, and blocks Save", () => {
    renderEditor();

    expect(screen.getByText(eval_.caseEditor.validJson)).toBeInTheDocument();

    fireEvent.change(expectedBox(), { target: { value: "[{ not json" } });

    expect(screen.getByText(eval_.caseEditor.invalidJson)).toBeInTheDocument();
    expect(screen.queryByText(eval_.caseEditor.validJson)).not.toBeInTheDocument();
    // The badge is not decoration: a case whose expected output cannot be
    // parsed would be stored as something the scorer can never match.
    expect(saveButton()).toBeDisabled();
  });

  it("treats an EMPTY box as the empty array, not as invalid", () => {
    // A `must_not_flag` case expects exactly nothing (server AC-21). Reporting
    // "invalid JSON" for the one direction the whole feature exists to express
    // would make it unsavable.
    renderEditor();
    fireEvent.change(expectedBox(), { target: { value: "" } });

    expect(screen.getByText(eval_.caseEditor.validJson)).toBeInTheDocument();
    expect(screen.getByText(eval_.evalsTab.mustNotFlag)).toBeInTheDocument();
  });
});

describe("EvalCaseEditor — the direction is derived, never chosen twice", () => {
  it("saves must_not_flag for an empty expectation and must_find for a populated one", async () => {
    renderEditor();

    fireEvent.change(nameBox(), { target: { value: "no-false-positive" } });
    fireEvent.change(expectedBox(), { target: { value: "[]" } });
    // The badge and the saved field are two readings of ONE parse, so a screen
    // that shows MUST NOT FLAG can never post `must_find`.
    expect(screen.getByText(eval_.evalsTab.mustNotFlag)).toBeInTheDocument();

    fireEvent.click(saveButton());
    await waitFor(() => expect(createMutate).toHaveBeenCalled());

    const body = lastCreateBody();
    expect(body.expectation).toBe("must_not_flag");
    // Not `null`: an empty array is "I expect nothing here", while null is "no
    // expectation was recorded" (server AC-21 names the difference by hand).
    expect(body.expected_output).toEqual([]);
    // UX-6 — there is no Files tab, so there is nothing that could fill this.
    expect(body.input_files).toBeNull();
    expect(body.owner_id).toBe("agent-1");
  });

  it("carries the trimmed name and the diff through to the request", async () => {
    renderEditor();

    fireEvent.change(nameBox(), { target: { value: "  stripe-key-leak  " } });
    fireEvent.change(diffBox(), { target: { value: "@@ -1 +1 @@\n+leak" } });
    fireEvent.change(expectedBox(), {
      target: { value: '[{"file":"src/config.ts","start_line":11,"end_line":11}]' },
    });

    fireEvent.click(saveButton());
    await waitFor(() => expect(createMutate).toHaveBeenCalled());

    const body = lastCreateBody();
    expect(body.name).toBe("stripe-key-leak");
    expect(body.input_diff).toBe("@@ -1 +1 @@\n+leak");
    expect(body.expectation).toBe("must_find");
  });

  it("will not save a case with no name", () => {
    // The name is how the case is found again in a set of a hundred, and the
    // server requires it — refusing here beats a 422 the reader has to decode.
    renderEditor();
    expect(saveButton()).toBeDisabled();
  });
});

describe("EvalCaseEditor — the two entry points (AC-97)", () => {
  it("opens on 'New eval case' with empty fields and creates", async () => {
    renderEditor();

    expect(screen.getByText(eval_.caseEditor.newCase)).toBeInTheDocument();
    expect(nameBox()).toHaveValue("");

    fireEvent.change(nameBox(), { target: { value: "fresh" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(createMutate).toHaveBeenCalled());
    // A new case must never travel the update route: `PUT /eval-cases/undefined`
    // is a 404 that reads as "saving is broken".
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("opens on an existing case pre-filled, and updates rather than creating", async () => {
    const existing = evalCase();
    const { onClose } = renderEditor({ evalCase: existing });

    expect(nameBox()).toHaveValue("hardcoded-secret");
    expect(diffBox()).toHaveValue(existing.input_diff);
    // The stored expectation is pretty-printed rather than shown as `[object
    // Object]` — this box is the only place a case's expectation is editable.
    expect(expectedBox()).toHaveValue(JSON.stringify(existing.expected_output, null, 2));

    fireEvent.click(saveButton());
    await waitFor(() => expect(updateMutate).toHaveBeenCalled());

    expect(updateMutate.mock.calls.at(-1)![0]).toMatchObject({ id: "case-1" });
    expect(createMutate).not.toHaveBeenCalled();
    // A successful save closes; leaving the modal up is how a reader saves the
    // same case three times.
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows a run action only when the consumer supplied one", () => {
    // L06 ships no single-case run endpoint. A permanently disabled Play button
    // would advertise an action that does not exist.
    renderEditor({ evalCase: evalCase() });
    expect(screen.queryByRole("button", { name: eval_.caseEditor.runCase })).not.toBeInTheDocument();

    cleanup();
    renderEditor({ evalCase: evalCase(), onRunCase: vi.fn() });
    expect(screen.getByRole("button", { name: eval_.caseEditor.runCase })).toBeInTheDocument();
  });
});

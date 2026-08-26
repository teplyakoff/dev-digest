import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ImportCandidates } from "@/lib/types";
import messages from "../../../../../../../messages/en/context.json";

/**
 * The picker's candidates come from the API through the hook, and this file
 * mocks the HOOK rather than passing a prop.
 *
 * That is the whole point of the test. A picker asserted against handed-in data
 * is green whether or not anything ever reaches it — which is how a badge in
 * this codebase stayed green for a full lesson without once appearing in the
 * app.
 */

const CANDIDATES: ImportCandidates = {
  candidates: [
    { path: "README.md", bytes: 1200, status: "ok" },
    { path: "docs/PRD.md", bytes: 4096, status: "ok" },
    { path: "docs/huge.md", bytes: 999_999, status: "skipped", reason: "too_large" },
  ],
  truncated: true,
};

const state = {
  data: undefined as ImportCandidates | undefined,
  isLoading: false,
  isError: false,
  error: null as unknown,
};

const rescan = vi.fn();

vi.mock("@/lib/hooks/context", () => ({
  useContextCandidates: () => state,
  useRescanContext: () => ({ mutate: rescan, isPending: false }),
}));

import { ContextImportPicker } from "./ContextImportPicker";

afterEach(() => {
  cleanup();
  rescan.mockReset();
  state.data = undefined;
  state.isLoading = false;
  state.isError = false;
  state.error = null;
});

function renderPicker(onImport = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextImportPicker repoId="r1" onImport={onImport} />
    </NextIntlClientProvider>,
  );
  return onImport;
}

describe("ContextImportPicker", () => {
  it("lists the repo's .md candidates from the API", () => {
    state.data = CANDIDATES;
    const onImport = renderPicker();

    expect(screen.getByRole("listitem", { name: "README.md" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("listitem", { name: "docs/PRD.md" }));
    expect(onImport).toHaveBeenCalledWith("docs/PRD.md");
  });

  it("shows a skipped candidate WITH its reason, and refuses to select it", () => {
    state.data = CANDIDATES;
    const onImport = renderPicker();

    const skipped = screen.getByRole("listitem", { name: "docs/huge.md" });
    expect(screen.getByText("Too large to import")).toBeInTheDocument();

    // Disabled, not merely grey. The assertion is that selection is
    // IMPOSSIBLE — a styled-grey row that still fires is the bug this catches.
    expect(skipped).toBeDisabled();
    fireEvent.click(skipped);
    expect(onImport).not.toHaveBeenCalled();
  });

  it("says so when the cap cut the list short", () => {
    state.data = CANDIDATES;
    renderPicker();
    expect(screen.getByText(/Showing the first 3 files/)).toBeInTheDocument();
  });

  it("renders an empty picker for a repo with no .md, without erroring", () => {
    state.data = { candidates: [], truncated: false };
    renderPicker();
    expect(screen.getByText("No .md files in this clone.")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("distinguishes 'not cloned yet' from a genuine failure", () => {
    // A 409 here is an ANSWER, and telling a person to retry a repo they have
    // simply not cloned sends them looking for a fault that is not there.
    state.isError = true;
    state.error = { details: { code: "not_cloned" } };
    renderPicker();
    expect(screen.getByRole("alert")).toHaveTextContent(/hasn’t been cloned yet/);

    cleanup();
    state.error = { details: { code: "conflict" } };
    renderPicker();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load this repo’s documents");
  });

  it("re-reads the clone on demand — AC-39's rescan", () => {
    // The clone moves under us on every poll, so somebody who has just added a
    // file needs a way to say "look again" without closing the picker.
    state.data = CANDIDATES;
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: "Rescan" }));
    expect(rescan).toHaveBeenCalled();
  });
});

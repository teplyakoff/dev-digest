import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextDoc } from "@/lib/types";
import messages from "../../../../../../../messages/en/context.json";
import { ContextDocList } from "./ContextDocList";

/**
 * The list rows in isolation: the name, what it costs, and the selection.
 *
 * This file passes `docs` by hand and therefore proves nothing about whether
 * anything ever reaches the list — that gap is `ContextView.test.tsx`'s job.
 */

const DOCS: ContextDoc[] = [
  {
    id: "d1",
    name: "ARCHITECTURE.md",
    bytes: 2048,
    tokens: 512,
    updated_at: "2026-08-22T10:00:00.000Z",
  },
  {
    id: "d2",
    name: "a-very-long-document-name-that-will-not-fit-in-the-row.md",
    bytes: 40,
    tokens: 9,
    updated_at: "2026-08-22T10:00:00.000Z",
  },
];

afterEach(cleanup);

function renderList(selectedId: string | null = null, onSelect = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextDocList docs={DOCS} selectedId={selectedId} onSelect={onSelect} />
    </NextIntlClientProvider>,
  );
  return onSelect;
}

describe("ContextDocList", () => {
  it("shows each document with its name and its token count", () => {
    renderList();
    // getByRole first: the Tier-1 query and the accessible-name requirement are
    // the same assertion, so a getByTestId here would also stop checking a11y.
    expect(screen.getByRole("listitem", { name: "ARCHITECTURE.md" })).toBeInTheDocument();
    expect(screen.getByText("512 tokens")).toBeInTheDocument();
    // Explicit plural arms, so a single-token document does not read "1 tokens".
    expect(screen.getByText("9 tokens")).toBeInTheDocument();
  });

  it("keeps a long name reachable through title rather than dropping it", () => {
    renderList();
    const long = screen.getByTitle(DOCS[1]!.name);
    expect(long).toBeInTheDocument();
  });

  it("marks the selected row as current and reports a click", () => {
    const onSelect = renderList("d1");
    const selected = screen.getByRole("listitem", { name: "ARCHITECTURE.md" });
    // State as state, not as colour: `aria-current` is what a screen reader can
    // read, and a background change alone is not.
    expect(selected).toHaveAttribute("aria-current", "true");

    fireEvent.click(screen.getByRole("listitem", { name: DOCS[1]!.name }));
    expect(onSelect).toHaveBeenCalledWith("d2");
  });
});

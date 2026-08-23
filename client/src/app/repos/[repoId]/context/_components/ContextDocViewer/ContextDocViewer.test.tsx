// NOTE — `fireEvent`, not `userEvent`, and it is a constraint rather than a
// preference: `@testing-library/user-event` is not a dependency of this package,
// and adding it to satisfy a skill's default would touch the lockfile for a
// two-click test.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextDocBody } from "@/lib/types";
import messages from "../../../../../../../messages/en/context.json";
import { ContextDocViewer } from "./ContextDocViewer";

const DOC: ContextDocBody = {
  id: "d1",
  name: "ARCHITECTURE.md",
  bytes: 42,
  tokens: 11,
  updated_at: "2026-08-22T10:00:00.000Z",
  body: "# Architecture\n\nThe store lives in Postgres.",
};

afterEach(cleanup);

function renderViewer(props: Partial<React.ComponentProps<typeof ContextDocViewer>> = {}) {
  const onSave = vi.fn();
  const onDelete = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextDocViewer
        doc={DOC}
        saving={false}
        saveError={null}
        deleting={false}
        onSave={onSave}
        onDelete={onDelete}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onSave, onDelete, ...utils };
}

describe("ContextDocViewer", () => {
  it("renders the body as markdown, not as raw text", () => {
    renderViewer();
    // The heading is a real heading, which is what says the markdown pipeline
    // ran. The primitive cannot render active content — which is precisely why
    // it is the right renderer for text imported out of somebody else's repo.
    expect(screen.getByRole("heading", { name: "Architecture" })).toBeInTheDocument();
  });

  it("switches to an editable field carrying the current body", () => {
    renderViewer();
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    const field = screen.getByRole("textbox", { name: "ARCHITECTURE.md" });
    expect(field).toHaveValue(DOC.body);
  });

  it("sends the edited body on save", () => {
    const { onSave } = renderViewer();
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "ARCHITECTURE.md" }), {
      target: { value: "# Architecture\n\nRewritten." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("# Architecture\n\nRewritten.");
  });

  it("shows a saving state, then returns to preview once the save lands", () => {
    const { rerender } = renderViewer();
    fireEvent.click(screen.getByRole("button", { name: "edit" }));

    const withSaving = (saving: boolean, saveError: string | null) =>
      rerender(
        <NextIntlClientProvider locale="en" messages={{ context: messages }}>
          <ContextDocViewer
            doc={DOC}
            saving={saving}
            saveError={saveError}
            deleting={false}
            onSave={vi.fn()}
            onDelete={vi.fn()}
          />
        </NextIntlClientProvider>,
      );

    withSaving(true, null);
    expect(screen.getByRole("button", { name: /Saving/ })).toBeDisabled();

    withSaving(false, null);
    // Back in preview: the heading is rendered again and the field is gone.
    expect(screen.getByRole("heading", { name: "Architecture" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("STAYS in edit mode when the save failed", () => {
    // Dropping back to preview on failure would hide the text the person is
    // about to lose, which is the worst possible moment to hide it.
    const { rerender } = renderViewer();
    fireEvent.click(screen.getByRole("button", { name: "edit" }));

    const withSaving = (saving: boolean, saveError: string | null) =>
      rerender(
        <NextIntlClientProvider locale="en" messages={{ context: messages }}>
          <ContextDocViewer
            doc={DOC}
            saving={saving}
            saveError={saveError}
            deleting={false}
            onSave={vi.fn()}
            onDelete={vi.fn()}
          />
        </NextIntlClientProvider>,
      );

    withSaving(true, null);
    withSaving(false, "Couldn’t load this document");

    expect(screen.getByRole("textbox", { name: "ARCHITECTURE.md" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load this document");
  });

  it("offers a delete control whose accessible name says which document", () => {
    const { onDelete } = renderViewer();
    // The name carries the document, not just the verb — "Delete" alone tells a
    // screen-reader user nothing about what is about to go.
    const button = screen.getByRole("button", { name: "Delete ARCHITECTURE.md" });
    fireEvent.click(button);
    expect(onDelete).toHaveBeenCalled();
  });
});

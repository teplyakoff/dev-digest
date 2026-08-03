import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SkillImportPreview } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";
import { ToastProvider } from "../../../../../../lib/toast";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const previewMutate = vi.fn();
const confirmMutate = vi.fn();
vi.mock("../../../../../../lib/hooks/skills", () => ({
  useImportPreview: () => ({ mutateAsync: previewMutate, isPending: false }),
  useImportConfirm: () => ({ mutateAsync: confirmMutate, isPending: false }),
}));

import { ImportSkillModal } from "./ImportSkillModal";

/**
 * The import preview is the trust boundary made visible. The assertion that
 * matters here is the ignored list: it is the product's evidence that nothing
 * executable was opened, so it has to render every entry the server reported.
 */
const PREVIEW: SkillImportPreview = {
  name: "uncovered-branch-gate",
  description: "Flag new conditional branches that no test asserts on.",
  type: "rubric",
  body: "# Uncovered branch gate\n\nCheck both sides of every new branch.",
  source: "imported_file",
  origin: { filename: "uncovered-branch-gate.zip", kind: "archive", bytes: 2048 },
  entry_path: "uncovered-branch-gate/SKILL.md",
  ignored: [
    { path: "uncovered-branch-gate/run.sh", reason: "not the skill body — never opened" },
    { path: "uncovered-branch-gate/package.json", reason: "not the skill body — never opened" },
  ],
  frontmatter: { used: ["name", "description", "type"], dropped: ["allowed-tools", "command"] },
  warnings: [],
};

afterEach(cleanup);
beforeEach(() => {
  push.mockReset();
  previewMutate.mockReset().mockResolvedValue(PREVIEW);
  confirmMutate.mockReset().mockResolvedValue({ id: "sk9", name: "uncovered-branch-gate" });
});

function renderModal() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <ToastProvider>
          <ImportSkillModal onClose={() => {}} />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/** Drive the hidden file input the way the picker button does. */
async function pickFile(name = "uncovered-branch-gate.zip") {
  const input = screen.getByTestId("skill-import-file") as HTMLInputElement;
  const file = new File(["zipbytes"], name);
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(previewMutate).toHaveBeenCalled());
}

describe("ImportSkillModal", () => {
  it("starts on the picker with nothing parsed and confirm disabled", () => {
    renderModal();
    expect(screen.getByText("Choose a .md or .zip file")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import skill/ })).toBeDisabled();
  });

  it("lists every ignored entry with its reason, and never the file contents", async () => {
    renderModal();
    await pickFile();

    expect(await screen.findByText("uncovered-branch-gate/run.sh")).toBeInTheDocument();
    expect(screen.getByText("uncovered-branch-gate/package.json")).toBeInTheDocument();
    expect(screen.getAllByText("not the skill body — never opened")).toHaveLength(2);

    // Dropped frontmatter is part of the same audit trail.
    expect(screen.getByText(/allowed-tools, command/)).toBeInTheDocument();
  });

  it("shows where the body came from", async () => {
    renderModal();
    await pickFile();
    expect(await screen.findByText("uncovered-branch-gate/SKILL.md")).toBeInTheDocument();
    expect(screen.getByText("uncovered-branch-gate.zip")).toBeInTheDocument();
    expect(screen.getByText("Archive")).toBeInTheDocument();
  });

  it("states that the skill saves disabled", async () => {
    renderModal();
    await pickFile();
    expect(
      await screen.findByText("Imported skills are saved disabled. Enable it once you have read it."),
    ).toBeInTheDocument();
  });

  it("confirms with the edited fields, not the parsed ones", async () => {
    renderModal();
    await pickFile();

    const nameInput = await screen.findByDisplayValue("uncovered-branch-gate");
    fireEvent.change(nameInput, { target: { value: "renamed-gate" } });
    fireEvent.click(screen.getByRole("button", { name: /Import skill/ }));

    await waitFor(() => expect(confirmMutate).toHaveBeenCalled());
    expect(confirmMutate.mock.calls[0]![0]).toMatchObject({
      name: "renamed-gate",
      // The provenance the server reported travels back unchanged.
      entry_path: "uncovered-branch-gate/SKILL.md",
      source: "imported_file",
    });
    expect(push).toHaveBeenCalledWith("/skills/sk9?tab=config");
  });

  it("renders a rejected upload inside the modal instead of losing it", async () => {
    previewMutate.mockRejectedValueOnce(new Error("No markdown file in that archive."));
    renderModal();
    await pickFile("empty.zip");

    expect(await screen.findByText("No markdown file in that archive.")).toBeInTheDocument();
    // Still on the picker — a 422 must not look like a half-finished import.
    expect(screen.getByRole("button", { name: /Import skill/ })).toBeDisabled();
  });

  it("surfaces normalisation warnings", async () => {
    previewMutate.mockResolvedValueOnce({
      ...PREVIEW,
      warnings: ['Name "My Rule" was normalised to "my-rule".'],
    });
    renderModal();
    await pickFile();
    expect(await screen.findByText(/normalised to "my-rule"/)).toBeInTheDocument();
  });
});

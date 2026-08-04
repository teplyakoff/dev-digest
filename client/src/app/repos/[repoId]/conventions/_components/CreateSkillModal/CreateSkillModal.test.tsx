import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionSkillDraft } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const createMutate = vi.fn();
const draftState: { data: ConventionSkillDraft | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: false,
};
vi.mock("@/lib/hooks/conventions", () => ({
  useConventionSkillDraft: () => ({ ...draftState, isError: false }),
  useCreateConventionSkill: () => ({ mutateAsync: createMutate, isPending: false }),
}));

import { CreateSkillModal } from "./CreateSkillModal";

/**
 * The modal edits the server's draft; it does not decide what is in it.
 *
 * That is the whole reason `skill-draft` is a server endpoint: "a rejected
 * candidate never reaches the skill" stays one assertion in `service.ts` rather
 * than a filter in this component that nobody can test from the outside. The
 * cases below pin that this component never composes a body of its own.
 */
const DRAFT: ConventionSkillDraft = {
  name: "repo-conventions",
  description: "2 house conventions extracted from acme/payments-api",
  type: "convention",
  enabled: true,
  body: "# repo-conventions\n\n## naming\n\n- Files are kebab-case.\n",
  candidate_ids: ["c1", "c2"],
};

afterEach(cleanup);
beforeEach(() => {
  push.mockReset();
  createMutate.mockReset().mockResolvedValue({ id: "sk9" });
  draftState.data = DRAFT;
  draftState.isLoading = false;
});

function renderModal(onClose = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <CreateSkillModal
        repoId="r1"
        repoFullName="acme/payments-api"
        acceptedCount={2}
        onClose={onClose}
      />
    </NextIntlClientProvider>,
  );
  return onClose;
}

describe("CreateSkillModal", () => {
  it("shows the SERVER's body verbatim, composing nothing itself", () => {
    renderModal();
    const editor = screen.getByLabelText("Skill body") as HTMLTextAreaElement;
    expect(editor.value).toBe(DRAFT.body);
  });

  it("names how many accepted conventions went in, and the repo", () => {
    renderModal();
    expect(screen.getByText(/2 accepted conventions/)).toBeInTheDocument();
    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
  });

  it("posts what the user edited, not the draft it was handed", () => {
    renderModal();
    const editor = screen.getByLabelText("Skill body") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "# edited\n\n- A rule.\n" } });
    fireEvent.click(screen.getByRole("button", { name: /Create skill/ }));
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ body: "# edited\n\n- A rule.\n" }),
    );
  });

  it("routes to the new skill, where linking it to an agent starts", async () => {
    const onClose = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /Create skill/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/skills/sk9?tab=config"));
    expect(onClose).toHaveBeenCalled();
  });

  it("blocks submit on a name too short to be a slug", () => {
    renderModal();
    const name = screen.getByDisplayValue("repo-conventions");
    fireEvent.change(name, { target: { value: "r" } });
    expect(screen.getByRole("button", { name: /Create skill/ })).toBeDisabled();
  });

  it.each([
    ["body", () => screen.getByLabelText("Skill body")],
    ["description", () => screen.getByDisplayValue(DRAFT.description)],
  ])("blocks submit on an empty %s", (_field, find) => {
    // The server now answers 422 for both (ConventionSkillDraft carries .min(1)
    // to match CreateSkillBody). This keeps the client from offering a submit
    // that can only fail — an empty ENABLED skill used to be creatable here and
    // rendered as an empty block in every linked agent's prompt.
    renderModal();
    fireEvent.change(find(), { target: { value: "  " } });
    expect(screen.getByRole("button", { name: /Create skill/ })).toBeDisabled();
  });

  it("shows a loading line rather than an empty form while the draft is in flight", () => {
    draftState.data = undefined;
    draftState.isLoading = true;
    renderModal();
    expect(screen.getByText(/Merging the accepted conventions/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Skill body")).not.toBeInTheDocument();
  });
});

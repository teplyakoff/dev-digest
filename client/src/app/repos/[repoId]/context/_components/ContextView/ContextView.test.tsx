import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextDoc } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/context.json";

/**
 * The page, from mocked API data through to what is on the screen.
 *
 * The distinction this file exists to pin: a failed list and a genuinely empty
 * store both produce an empty array and mean OPPOSITE things. Rendering the
 * failure as "nothing here yet" tells a person to start adding documents they
 * may already have — and the blast tab had to learn that the hard way.
 */

const DOCS: ContextDoc[] = [
  { id: "d1", name: "ARCHITECTURE.md", bytes: 2048, tokens: 512, agents: 2, updated_at: "2026-08-22T10:00:00.000Z" },
  { id: "d2", name: "PRD.md", bytes: 1024, tokens: 256, agents: 0, updated_at: "2026-08-22T10:00:00.000Z" },
];

const create = vi.fn();
const remove = vi.fn();
const state = {
  docs: undefined as ContextDoc[] | undefined,
  isLoading: false,
  isError: false,
  /** What `GET /repos/:id/context/store` answered, or nothing yet. */
  store: undefined as { docs: number; total_bytes: number } | undefined,
};

vi.mock("@/lib/hooks/context", () => ({
  useContextDocs: () => ({ ...state, data: state.docs, refetch: vi.fn() }),
  useContextDoc: () => ({ data: undefined }),
  useContextStore: () => ({ data: state.store }),
  useCreateContextDoc: () => ({ mutate: create, isPending: false }),
  useDeleteContextDoc: () => ({ mutate: remove, isPending: false }),
  useSaveContextDoc: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useContextCandidates: () => ({ data: undefined, isLoading: false, isError: false, error: null }),
  useRescanContext: () => ({ mutate: vi.fn(), isPending: false }),
  useAgentContextDocs: () => ({ data: [] }),
  useSkillContextDocs: () => ({ data: [] }),
  useSetAgentContextDocs: () => ({ mutate: vi.fn() }),
  useSetSkillContextDocs: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: [] }) }));
vi.mock("@/lib/hooks/skills", () => ({ useSkills: () => ({ data: [] }) }));
vi.mock("@/lib/repo-context", () => ({ useRepoNotFound: () => false }));
// The shell pulls in the repo switcher, theme and router context; none of it is
// what this test is about.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ repoId: "r1" }) }));

import { ContextView } from "./ContextView";

afterEach(() => {
  cleanup();
  create.mockReset();
  remove.mockReset();
  state.docs = undefined;
  state.isLoading = false;
  state.isError = false;
  state.store = undefined;
});

function renderView() {
  render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextView />
    </NextIntlClientProvider>,
  );
}

describe("ContextView", () => {
  it("offers three ways to add a document", () => {
    state.docs = DOCS;
    renderView();
    expect(screen.getByRole("button", { name: "Import from repo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New document" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload .md" })).toBeInTheDocument();
  });

  /* AC-52. The number comes from the LIST DATA, not from a prop this test
     hands to the row: `ContextDocList.test.tsx` passes `docs` by hand and
     therefore cannot tell whether anything ever reaches the row. Here it
     arrives the way it does in the app — through the mocked `useContextDocs`. */
  it("shows how many agents each document reaches, from the list data", () => {
    state.docs = DOCS;
    renderView();

    expect(screen.getByText("2 agents")).toBeInTheDocument();
    expect(screen.getByText("no agents")).toBeInTheDocument();
  });

  it("shows a status line of documents and size — and never a chunk count", () => {
    state.docs = DOCS;
    renderView();
    // Before the server's own count arrives, the list is summed locally so the
    // line is never blank.
    expect(screen.getByText("2 documents · 3.0 kB")).toBeInTheDocument();
    // Chunking is a deliberate non-goal. A status line that mentioned chunks or
    // an index state would advertise a feature nobody built.
    expect(screen.queryByText(/chunk/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Index status/i)).not.toBeInTheDocument();
  });

  it("renders an empty store as an empty state with a call to action", () => {
    state.docs = [];
    renderView();
    expect(screen.getByText("No documents yet")).toBeInTheDocument();
    expect(screen.getByText(/only once you attach it/)).toBeInTheDocument();
  });

  it("renders a FAILED list as an error, distinguishable from empty", () => {
    state.isError = true;
    state.docs = undefined;
    renderView();

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load this repo’s documents");
    // The assertion that matters: "we could not read your documents" must not
    // arrive as "you have no documents".
    expect(screen.queryByText("No documents yet")).not.toBeInTheDocument();
  });

  it("creates a named, empty document from the inline field", () => {
    state.docs = DOCS;
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "New document" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New document" }), {
      target: { value: "NOTES.md" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "New document" })[1]!);

    expect(create).toHaveBeenCalledWith({ kind: "text", name: "NOTES.md", body: "" });
  });

  it("opens the import picker only when asked", () => {
    state.docs = DOCS;
    renderView();
    expect(screen.queryByText("Import from this repo")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import from repo" }));
    expect(screen.getByText("Import from this repo")).toBeInTheDocument();
  });

  it("prefers the SERVER's store totals once they arrive", () => {
    // `total_bytes` is a SQL `sum(octet_length(body))` — the same arithmetic the
    // store bound is enforced with. Once the server has answered, a second count
    // derived from the list is a second source of truth for one number.
    state.docs = DOCS;
    state.store = { docs: 2, total_bytes: 4096 };
    renderView();
    expect(screen.getByText("2 documents · 4.0 kB")).toBeInTheDocument();
  });
});

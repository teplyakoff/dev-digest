import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import eval_ from "../../../../../../messages/en/eval.json";
import { ToastProvider } from "../../../../../lib/toast";

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
}));

// SPEC-08 — the Evals tab's own hooks, for the same reason: this file asserts
// which tab the editor SHOWS, not what the tab fetches.
vi.mock("@/lib/hooks/evals", () => ({
  useEvalCases: () => ({ data: [], isLoading: false, isError: false }),
  useEvalDashboard: () => ({ data: undefined }),
  useRunEvalBatch: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useDeleteEvalCase: () => ({ mutate: vi.fn() }),
  useCreateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useUpdateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
}));

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

import { AgentEditor } from "./AgentEditor";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages, eval: eval_ }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
  });
});

/* SPEC-08 AC-69 / AC-70 — the Evals tab.

   `constants.ts` and `AgentEditor.tsx` are two edits that have to land
   together: a `TABS` entry with no branch in the body renders Config and errors
   on nothing, so `?tab=evals` would be accepted by `VALID_TABS` and the page
   would silently look fine. That is precisely what these two tests separate. */
describe("SPEC-08 — the Evals tab", () => {
  it("AC-69 — lists an evals tab among the editor's tabs", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByRole("button", { name: /Evals/ })).toBeInTheDocument();
  });

  it("AC-70 — renders the eval set's own content when the URL selects that tab", () => {
    // The half a tab-strip assertion cannot see: the tab is SHOWN, not merely
    // offered. Config's heading must be gone and the eval set's must be there.
    renderWithIntl(<AgentEditor agent={AGENT} tab="evals" onTab={() => {}} />);

    expect(screen.getByText(eval_.evalsTab.metricsTitle)).toBeInTheDocument();
    expect(screen.getByText(eval_.evalsTab.casesHeading)).toBeInTheDocument();
    expect(screen.queryByText("Configuration")).not.toBeInTheDocument();
  });
});

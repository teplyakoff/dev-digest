import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../messages/en/agents.json";

/**
 * The regression this file exists for: `AgentCard` has always been able to
 * render the skill-count badge, and the list has always been the only thing
 * that could tell it the number. It didn't — so every card in the grid showed a
 * model chip and nothing else, and the gap was invisible from either side on
 * its own. `AgentCard.test.tsx` passes `skillCount` by hand and proves nothing
 * about the wiring; this asserts the value actually travels from the API
 * response to the badge.
 */

const AGENTS: Agent[] = [
  {
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
    skills_count: 2,
  },
  {
    id: "ag2",
    name: "General Reviewer",
    description: "Reviews a diff for bugs",
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "You are a reviewer.",
    output_schema: null,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    enabled: true,
    version: 1,
    skills_count: 0,
  },
];

vi.mock("../../../../lib/hooks/agents", () => ({
  useAgents: () => ({ data: AGENTS, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAgent: () => ({ mutate: vi.fn(), isPending: false }),
}));

// The shell pulls in the repo switcher, theme and router context; none of it is
// what this test is about.
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { AgentsListView } from "./AgentsListView";

afterEach(cleanup);

function renderView() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
        <AgentsListView />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("AgentsListView — the skill-count badge is fed from the API", () => {
  it("renders each agent's skills_count on its card", () => {
    renderView();
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("2 skills")).toBeInTheDocument();
    // An agent with an empty knowledge layer says so rather than hiding it.
    expect(screen.getByText("0 skills")).toBeInTheDocument();
  });
});

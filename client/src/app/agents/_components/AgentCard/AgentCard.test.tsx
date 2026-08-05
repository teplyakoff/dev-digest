import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../messages/en/agents.json";
import { AgentCard } from "./AgentCard";

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
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("AgentCard (smoke)", () => {
  it("renders the agent name, model chip and skill count", () => {
    renderWithIntl(<AgentCard ag={AGENT} skillCount={3} />);
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("gpt-4.1")).toBeInTheDocument();
    expect(screen.getByText("3 skills")).toBeInTheDocument();
  });

  it("falls back to a translated placeholder when description is empty", () => {
    renderWithIntl(<AgentCard ag={{ ...AGENT, description: "" }} />);
    expect(screen.getByText("No description")).toBeInTheDocument();
  });

  // Zero is a real answer — an agent with no knowledge layer is exactly what the
  // badge should say out loud — while an absent count means the caller never
  // loaded one and must render nothing at all.
  it("renders a zero badge, and no badge when the count is absent", () => {
    renderWithIntl(<AgentCard ag={AGENT} skillCount={0} />);
    expect(screen.getByText("0 skills")).toBeInTheDocument();

    cleanup();
    renderWithIntl(<AgentCard ag={AGENT} />);
    expect(screen.queryByText(/skills?$/)).not.toBeInTheDocument();
  });

  it("says “1 skill”, not “1 skills”", () => {
    renderWithIntl(<AgentCard ag={AGENT} skillCount={1} />);
    expect(screen.getByText("1 skill")).toBeInTheDocument();
  });
});

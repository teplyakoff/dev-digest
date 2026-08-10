import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillStats } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";

const stats = vi.hoisted(() => ({ current: null as SkillStats | null }));

vi.mock("../../../../../../lib/hooks/skills", () => ({
  useSkillStats: () => ({
    data: stats.current,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { SkillStatsTab } from "./SkillStatsTab";

afterEach(cleanup);

const SKILL: Skill = {
  id: "sk1",
  name: "breaking-change",
  description: "Flag a change that stops an existing caller from working.",
  type: "convention",
  source: "manual",
  body: "# Breaking changes",
  enabled: true,
  version: 2,
};

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <SkillStatsTab skill={SKILL} />
    </NextIntlClientProvider>,
  );
}

describe("SkillStatsTab", () => {
  it("shows what the skill cost across the runs that loaded it", () => {
    stats.current = {
      agents: [{ agent_id: "ag1", agent_name: "API Contract Reviewer" }],
      runs: 4,
      tokens_total: 3200,
      tokens_avg: 800,
      last_loaded_at: "2026-08-04T09:30:00.000Z",
    };
    renderTab();
    expect(screen.getByText("4")).toBeInTheDocument();
    // The separator is stable because the component pins "en-US"; with a bare
    // toLocaleString() this assertion would pass on jsdom's default locale and
    // still render "3 200" on a machine set to anything else.
    expect(screen.getByText("3,200")).toBeInTheDocument();
    expect(screen.getByText("800")).toBeInTheDocument();
    expect(screen.getByText("API Contract Reviewer")).toBeInTheDocument();
    expect(screen.getByText(/Last loaded/)).toBeInTheDocument();
  });

  /**
   * The state every new skill is in. Four zeroes would read as "measured, and it
   * did nothing" — the truth is that nothing has run it, which is a different
   * thing and has a different next step.
   */
  it("tells an unlinked skill what to do instead of rendering zeroes", () => {
    stats.current = {
      agents: [],
      runs: 0,
      tokens_total: 0,
      tokens_avg: 0,
      last_loaded_at: null,
    };
    renderTab();
    expect(screen.getByText("No usage yet")).toBeInTheDocument();
    expect(screen.queryByText("RUNS")).not.toBeInTheDocument();
  });

  it("keeps the tiles for a linked skill no run has loaded yet", () => {
    stats.current = {
      agents: [{ agent_id: "ag1", agent_name: "Security Reviewer" }],
      runs: 0,
      tokens_total: 0,
      tokens_avg: 0,
      last_loaded_at: null,
    };
    renderTab();
    expect(screen.getByText("RUNS")).toBeInTheDocument();
    expect(screen.getByText("Linked, but no run has loaded it yet.")).toBeInTheDocument();
  });
});

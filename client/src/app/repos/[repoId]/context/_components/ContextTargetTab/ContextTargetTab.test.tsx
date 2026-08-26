// NOTE — `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
// dependency of this package, and NFR-6 is asserted through roles and ARIA state
// rather than through a simulated pointer, which is what actually makes it a
// screen-reader assertion.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AttachedDoc, ContextDoc, Skill } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/context.json";

/**
 * Attachment, asserted at the TAB from mocked API data — never by handing a
 * component the number it is supposed to display.
 *
 * The spec pins the level deliberately. A badge asserted from a hand-passed prop
 * was green in this codebase for a whole lesson without once appearing in the
 * running app, because the only thing that could have supplied the value never
 * did. So the token totals, the used-by count and the warning are all checked
 * from the tab down.
 */

const DOCS: ContextDoc[] = [
  { id: "d1", name: "SMALL.md", bytes: 40, tokens: 10, agents: 0, updated_at: "2026-08-22T10:00:00.000Z" },
  { id: "d2", name: "HUGE.md", bytes: 90_000, tokens: 25_000, agents: 0, updated_at: "2026-08-22T10:00:00.000Z" },
];

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets",
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

const SKILL: Skill = {
  id: "sk1",
  name: "test-coverage",
  description: "Flag new branches no test asserts on",
  type: "rubric",
  source: "manual",
  body: "# Tests",
  enabled: true,
  version: 1,
  used_by: 3,
};

const attach = { agent: vi.fn(), skill: vi.fn() };
const state = {
  agentDocs: [] as AttachedDoc[],
  skillDocs: [] as AttachedDoc[],
};

vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: [AGENT] }) }));
vi.mock("@/lib/hooks/skills", () => ({ useSkills: () => ({ data: [SKILL] }) }));
vi.mock("@/lib/hooks/context", () => ({
  useAgentContextDocs: (id: string | null) => ({ data: id ? state.agentDocs : undefined }),
  useSkillContextDocs: (id: string | null) => ({ data: id ? state.skillDocs : undefined }),
  useSetAgentContextDocs: () => ({ mutate: attach.agent }),
  useSetSkillContextDocs: () => ({ mutate: attach.skill }),
}));

import { ContextTargetTab } from "./ContextTargetTab";

afterEach(() => {
  cleanup();
  attach.agent.mockReset();
  attach.skill.mockReset();
  state.agentDocs = [];
  state.skillDocs = [];
});

const attached = (doc: ContextDoc): AttachedDoc => ({ ...doc, missing: false });

function renderTab() {
  render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextTargetTab docs={DOCS} />
    </NextIntlClientProvider>,
  );
}

describe("ContextTargetTab", () => {
  it("gives every control an accessible name that includes the document name", () => {
    renderTab();
    // NFR-6, made checkable: "Attach" alone tells a screen-reader user nothing
    // about WHICH document. getByRole is the Tier-1 query and the accessible
    // -name assertion at the same time.
    expect(screen.getByRole("button", { name: "Attach SMALL.md" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attach HUGE.md" })).toBeInTheDocument();
  });

  it("exposes attachment as STATE, not as colour, and is operable from the keyboard", () => {
    state.agentDocs = [attached(DOCS[0]!)];
    renderTab();

    const on = screen.getByRole("button", { name: "Detach SMALL.md", pressed: true });
    const off = screen.getByRole("button", { name: "Attach HUGE.md", pressed: false });
    expect(on).toBeInTheDocument();
    expect(off).toBeInTheDocument();

    // A real <button>, so Enter and Space already work and focus reaches it in
    // tab order. Asserting the element type is asserting the keyboard contract.
    expect(off.tagName).toBe("BUTTON");
    off.focus();
    expect(off).toHaveFocus();
  });

  it("sends the target's WHOLE id set in one request, never a delta", () => {
    state.agentDocs = [attached(DOCS[0]!)];
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: "Attach HUGE.md" }));
    // Both ids, not just the one that changed. The endpoint REPLACES, so a
    // delta would silently detach SMALL.md while every request looked correct.
    expect(attach.agent).toHaveBeenCalledWith(["d1", "d2"]);

    attach.agent.mockReset();
    fireEvent.click(screen.getByRole("button", { name: "Detach SMALL.md" }));
    // Detaching the only attachment sends an EMPTY array — the only way to say
    // "nothing" in a replace protocol.
    expect(attach.agent).toHaveBeenCalledWith([]);
  });

  it("shows each target's summed attachment token count", () => {
    state.agentDocs = [attached(DOCS[0]!), attached(DOCS[1]!)];
    renderTab();
    expect(screen.getByText("25,010 tokens attached")).toBeInTheDocument();
  });

  it("warns past the token threshold WITHOUT blocking the control", () => {
    state.agentDocs = [attached(DOCS[1]!)];
    renderTab();

    expect(screen.getByRole("status")).toHaveTextContent(/lot of context/);
    // Warns, never blocks: a person who deliberately attached a large
    // specification is not making a mistake the page should refuse.
    expect(screen.getByRole("button", { name: "Attach SMALL.md" })).toBeEnabled();
  });

  it("shows a document that has left the store as missing, and still detachable", () => {
    state.agentDocs = [
      {
        id: "gone",
        name: "DELETED.md",
        bytes: 0,
        tokens: 0,
        agents: 0,
        updated_at: "1970-01-01T00:00:00.000Z",
        missing: true,
      },
    ];
    renderTab();

    const ghost = screen.getByRole("button", { name: /DELETED\.md/ });
    expect(ghost).toHaveAccessibleName(/no longer in the store/);
    fireEvent.click(ghost);
    expect(attach.agent).toHaveBeenCalledWith([]);
  });

  it("shows how many agents use each skill, from the skills API", () => {
    renderTab();
    fireEvent.click(screen.getByRole("tab", { name: "Skills" }));
    // AC-28 reads `Skill.used_by`, the aggregate that already ships. A second
    // count computed here would be a second source of truth for one sentence.
    // Scoped by ROLE and accessible name, not by `closest('div')`. The DOM walk
    // depended on the exact nesting: a styling wrapper between the label and the
    // row would have rescoped `within()` to the wrong element and the assertion
    // would have gone on passing.
    const row = screen.getByRole("group", { name: "test-coverage" });
    expect(within(row).getByText("Used by 3 agents")).toBeInTheDocument();
  });
});

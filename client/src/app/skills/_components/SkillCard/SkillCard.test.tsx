import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { SkillCard } from "./SkillCard";
import { needsVetting, filterSkills } from "./helpers";

afterEach(cleanup);

const SKILL: Skill = {
  id: "sk1",
  name: "test-quality-rubric",
  description: "Flag new branches that no test asserts on.",
  type: "rubric",
  source: "manual",
  body: "# Tests\nCover new branches.",
  enabled: true,
  version: 3,
  evidence_files: null,
};

function renderCard(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SkillCard", () => {
  it("renders name, description, type pill and source chip", () => {
    renderCard(<SkillCard skill={SKILL} />);
    expect(screen.getByText("test-quality-rubric")).toBeInTheDocument();
    expect(screen.getByText("Flag new branches that no test asserts on.")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
  });

  it("shows the usage footer only when a count was loaded", () => {
    // `undefined` = not loaded, `0` = genuinely no agents. Rendering "0 agents"
    // for the first would be a claim the list endpoint never made.
    const { rerender } = renderCard(<SkillCard skill={SKILL} usedBy={2} />);
    expect(screen.getByText("2 agents")).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <SkillCard skill={SKILL} usedBy={undefined} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText(/agents?$/)).not.toBeInTheDocument();
  });

  it("toggles with the inverted value", () => {
    const onToggle = vi.fn();
    renderCard(<SkillCard skill={SKILL} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("does not open the card when the toggle is clicked", () => {
    const onClick = vi.fn();
    renderCard(<SkillCard skill={SKILL} onClick={onClick} onToggle={vi.fn()} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("badges an imported, not-yet-enabled skill as needing vetting", () => {
    renderCard(<SkillCard skill={{ ...SKILL, source: "imported_file", enabled: false }} />);
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
    expect(screen.getByText("Imported")).toBeInTheDocument();
  });

  it("drops the vetting badge once the skill is enabled", () => {
    // Enabling IS the act of adopting the text — after that it is the user's.
    renderCard(<SkillCard skill={{ ...SKILL, source: "imported_file", enabled: true }} />);
    expect(screen.queryByText("needs vetting")).not.toBeInTheDocument();
  });
});

describe("needsVetting", () => {
  it.each([
    ["imported_file", false, true],
    ["community", false, true],
    ["imported_url", false, true],
    ["imported_file", true, false],
    ["manual", false, false],
    ["extracted", false, false],
  ] as const)("source=%s enabled=%s → %s", (source, enabled, expected) => {
    expect(needsVetting({ source, enabled })).toBe(expected);
  });
});

describe("filterSkills", () => {
  const other: Skill = {
    ...SKILL,
    id: "sk2",
    name: "api-contract-guard",
    type: "convention",
    description: "Flag breaking route signature changes.",
  };

  it("matches name, description and type, case-insensitively", () => {
    expect(filterSkills([SKILL, other], "CONTRACT").map((s) => s.id)).toEqual(["sk2"]);
    expect(filterSkills([SKILL, other], "branches").map((s) => s.id)).toEqual(["sk1"]);
    expect(filterSkills([SKILL, other], "rubric").map((s) => s.id)).toEqual(["sk1"]);
  });

  it("returns everything for an empty or whitespace query", () => {
    expect(filterSkills([SKILL, other], "   ")).toHaveLength(2);
  });
});

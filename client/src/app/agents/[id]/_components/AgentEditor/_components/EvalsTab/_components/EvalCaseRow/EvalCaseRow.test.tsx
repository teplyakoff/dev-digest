// NOTE — `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
// dependency of this package and every existing test here uses `fireEvent`
// (client/INSIGHTS.md, "Codebase Patterns").
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseRecord, EvalRunRecord } from "@devdigest/shared";
// TEN levels up from `.../EvalsTab/_components/EvalCaseRow/` — the specifier
// is copied from a sibling rather than counted (client/INSIGHTS.md).
import eval_ from "../../../../../../../../../../messages/en/eval.json";
import { EvalCaseRow } from "./EvalCaseRow";

afterEach(cleanup);

function evalCase(o: Partial<EvalCaseRecord> = {}): EvalCaseRecord {
  return {
    id: "case-1",
    owner_kind: "agent",
    owner_id: "agent-1",
    name: "hardcoded-secret",
    input_diff: "@@ -1 +1 @@",
    input_files: null,
    input_meta: null,
    expected_output: [],
    notes: null,
    expectation: "must_find",
    source_finding_id: "f1",
    ...o,
  };
}

function run(o: Partial<EvalRunRecord> = {}): EvalRunRecord {
  return {
    id: "run-1",
    case_id: "case-1",
    case_name: "hardcoded-secret",
    ran_at: "2026-08-20T10:00:00.000Z",
    actual_output: null,
    pass: true,
    status: "passed",
    recall: 0.75,
    precision: 1,
    citation_accuracy: 1,
    duration_ms: 4200,
    cost_usd: 0.0013,
    ...o,
  };
}

function renderRow(props: Partial<React.ComponentProps<typeof EvalCaseRow>> = {}) {
  const onEdit = props.onEdit ?? vi.fn();
  const onDelete = props.onDelete ?? vi.fn();
  const view = render(
    <NextIntlClientProvider locale="en" messages={{ eval: eval_ }}>
      <EvalCaseRow evalCase={evalCase()} {...props} onEdit={onEdit} onDelete={onDelete} />
    </NextIntlClientProvider>,
  );
  return { ...view, onEdit, onDelete };
}

/**
 * The status glyph is an `img`-role span whose accessible name IS the state, so
 * the three outcomes are told apart by name rather than by icon file or colour
 * — neither of which a jsdom test can honestly read.
 */
const statusIcon = () => screen.getByRole("img");

describe("EvalCaseRow — errored is a THIRD state, not a shade of failed (AC-79)", () => {
  it("labels a passed run", () => {
    renderRow({ lastRun: run() });
    expect(statusIcon()).toHaveAccessibleName(eval_.evalsTab.passed);
    // The recall suffix carries its own separator and is appended only when
    // there is a recall to append.
    expect(screen.getByText(/passed · recall 75%/)).toBeInTheDocument();
  });

  it("labels a failed run — the agent answered, and the answer was wrong", () => {
    renderRow({ lastRun: run({ pass: false, status: "failed", recall: 0 }) });
    expect(statusIcon()).toHaveAccessibleName(eval_.evalsTab.failed);
    expect(statusIcon()).not.toHaveAttribute("title");
    // A genuine zero recall IS a measurement and is shown.
    expect(screen.getByText(/failed · recall 0%/)).toBeInTheDocument();
  });

  it("labels an ERRORED run with its own name and its own tooltip", () => {
    // The distinction the criterion exists for: `failed` means the agent was
    // wrong, `errored` means it never produced a comparable answer at all
    // (unparseable diff, timeout, provider error). Collapsing the two makes a
    // broken harness look like a bad agent.
    renderRow({
      lastRun: run({ pass: null, status: "errored", recall: null, precision: null }),
    });

    expect(statusIcon()).toHaveAccessibleName(eval_.evalsTab.errored);
    expect(statusIcon()).not.toHaveAccessibleName(eval_.evalsTab.failed);
    // Only this state earns an explanation, because it is the one a reader is
    // most likely to read as a terrible score.
    expect(statusIcon()).toHaveAttribute("title", eval_.evalsTab.erroredTooltip);
    // …and no metric is invented for it.
    expect(screen.getByText(eval_.evalsTab.errored)).toBeInTheDocument();
    expect(screen.queryByText(/recall/)).not.toBeInTheDocument();
  });

  it("AC-78 — a case that never ran is neutral, not a failure", () => {
    renderRow({ lastRun: undefined });
    expect(statusIcon()).toHaveAccessibleName(eval_.evalsTab.neverRun);
    expect(statusIcon()).not.toHaveAccessibleName(eval_.evalsTab.failed);
    expect(screen.queryByText(/recall/)).not.toBeInTheDocument();
  });

  it("an unknown recall on a passed run appends no suffix — never 0%", () => {
    renderRow({ lastRun: run({ recall: null }) });
    expect(screen.getByText(eval_.evalsTab.passed)).toBeInTheDocument();
    expect(screen.queryByText(/recall 0%/)).not.toBeInTheDocument();
  });
});

describe("EvalCaseRow — direction and provenance", () => {
  it("AC-82 — shows the expectation direction as its own badge", () => {
    renderRow({ evalCase: evalCase({ expectation: "must_find" }) });
    expect(screen.getByText(eval_.evalsTab.mustFind)).toBeInTheDocument();

    cleanup();
    renderRow({ evalCase: evalCase({ expectation: "must_not_flag" }) });
    // Direction changes what a PASS means, so it has to be readable without
    // decoding a colour.
    expect(screen.getByText(eval_.evalsTab.mustNotFlag)).toBeInTheDocument();
  });

  it("AC-83 — the provenance tooltip names the decision the case came from", () => {
    renderRow({ evalCase: evalCase({ expectation: "must_find", source_finding_id: "f1" }) });
    expect(screen.getByText(eval_.evalsTab.mustFind)).toHaveAttribute(
      "title",
      eval_.evalsTab.seededFromAccepted,
    );

    cleanup();
    renderRow({ evalCase: evalCase({ expectation: "must_not_flag", source_finding_id: "f9" }) });
    expect(screen.getByText(eval_.evalsTab.mustNotFlag)).toHaveAttribute(
      "title",
      eval_.evalsTab.seededFromDismissed,
    );
  });

  it("AC-83 — emits NO tooltip when the source finding is gone", () => {
    // `source_finding_id` is ON DELETE SET NULL, so a case outlives its origin.
    // The claim "seeded from a decided finding" becomes false the moment the
    // finding goes, and the attribute must be absent rather than empty — an
    // empty `title` still renders a tooltip box on hover.
    renderRow({ evalCase: evalCase({ source_finding_id: null }) });
    expect(screen.getByText(eval_.evalsTab.mustFind)).not.toHaveAttribute("title");
  });
});

describe("EvalCaseRow — the row's actions", () => {
  it("opens the editor from the name and from Edit, and deletes from Delete", () => {
    const case_ = evalCase({ name: "a-very-long-case-name-that-truncates" });
    const { onEdit, onDelete } = renderRow({ evalCase: case_ });

    // The name is the button, so the row needs no click handler of its own —
    // and the FULL name lives in `title`, because the truncation is visual only
    // and a case list is unreadable when nine rows all read "hardcoded-sec…".
    const name = screen.getByRole("button", { name: case_.name });
    expect(name).toHaveAttribute("title", case_.name);

    fireEvent.click(name);
    fireEvent.click(screen.getByRole("button", { name: eval_.evalsTab.edit }));
    expect(onEdit).toHaveBeenCalledTimes(2);
    expect(onEdit).toHaveBeenLastCalledWith(case_);

    fireEvent.click(screen.getByRole("button", { name: eval_.evalsTab.delete }));
    expect(onDelete).toHaveBeenCalledWith(case_);
  });

  it("offers a per-case Run action only when a consumer supplied one", () => {
    // L06 has no single-case run endpoint; a disabled Play button would promise
    // one.
    renderRow({});
    expect(screen.queryByRole("button", { name: eval_.evalsTab.run })).not.toBeInTheDocument();

    cleanup();
    renderRow({ onRun: vi.fn() });
    expect(screen.getByRole("button", { name: eval_.evalsTab.run })).toBeInTheDocument();
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
// TEN levels up. A test in a nested `_components/<Name>/` folder is two deeper
// than `RunTraceDrawer.test.tsx`, and counting the segments by eye gets it wrong
// — the failure is at import time and names no correct depth. Derive it, do not
// guess it.
import messages from "../../../../../../../../../../messages/en/runs.json";
import { TraceBody } from "./TraceBody";

/**
 * The `Project context` block in the run trace.
 *
 * Two states, and the second is the one worth a test: a trace WITH documents
 * shows the block and what it cost, and a trace without renders exactly as it
 * always did — no row, and certainly not an empty one. Every trace persisted
 * before L06 is the second case, so "renders unchanged" is not hypothetical.
 */

const BASE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: {
    duration_ms: 8200,
    tokens_in: 12000,
    tokens_out: 1500,
    cost_usd: 0.014,
    findings: 0,
    grounding: "0/0 passed",
  },
  prompt_assembly: {
    system: "You are a reviewer.",
    skills: null,
    memory: null,
    specs: null,
    user: "Review PR #482",
  },
  tool_calls: [],
  raw_output: "{}",
  memory_pulled: [],
  specs_read: [],
  log: [],
};

afterEach(cleanup);

/**
 * `Prompt assembly` ships collapsed, so its blocks are not in the DOM until the
 * section is opened. Every assertion below is about what is inside it.
 */
function renderBody(trace: RunTrace) {
  render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">
        <TraceBody trace={trace} findings={[]} />
      </div>
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByText("Prompt assembly"));
}

describe("TraceBody — Project context", () => {
  it("shows the block with its token count, and expands to the full text", () => {
    renderBody({
      ...BASE,
      config: {
        ...BASE.config,
        specs: [
          { name: "ARCHITECTURE.md", tokens: 1_200 },
          { name: "PRD.md", tokens: 3_010 },
        ],
      },
      prompt_assembly: {
        ...BASE.prompt_assembly,
        specs: '<untrusted source="spec-0">\nThe store lives in Postgres.\n</untrusted>',
      },
      specs_read: ["ARCHITECTURE.md", "PRD.md"],
    });

    // Summed from the counts the SERVER measured. A chars/4 estimate computed
    // here would disagree with what the run actually paid.
    const header = screen.getByText(/Project context \(dynamic\) · 4,210 tokens/);
    expect(header).toBeInTheDocument();

    fireEvent.click(header);
    expect(screen.getByText(/The store lives in Postgres/)).toBeInTheDocument();
  });

  it("renders a trace with no project context exactly as before — no row at all", () => {
    renderBody(BASE);
    // Not "an empty Project context block": no block. The `!= null` guard is
    // what every pre-L06 trace depends on.
    expect(screen.queryByText(/Project context/)).not.toBeInTheDocument();
  });

  it("shows the block with a zero count rather than hiding it, if a run ever stores one", () => {
    // `config.specs` absent while `prompt_assembly.specs` is present is only
    // reachable on a trace written by an older build. The header degrades to
    // "0 tokens" instead of the block vanishing, because the text WAS sent.
    renderBody({
      ...BASE,
      prompt_assembly: { ...BASE.prompt_assembly, specs: "<untrusted source=\"spec-0\">\nold\n</untrusted>" },
    });
    expect(screen.getByText(/Project context \(dynamic\) · 0 tokens/)).toBeInTheDocument();
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate, ConventionScan } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";
import { ConventionCard } from "./ConventionCard";

afterEach(cleanup);

const SCAN: ConventionScan = {
  id: "scan1",
  repo_id: "r1",
  indexed_sha: "a1b2c3d4e5f6a7b8",
  sampled_files: ["src/api/users.ts"],
  config_files: ["tsconfig.json"],
  proposed: 3,
  kept: 1,
  dropped: [{ rule: "ghost", reason: "file_not_sampled" }],
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  tokens_in: 100,
  tokens_out: 50,
  cost_usd: 0.0001,
  created_at: "2026-08-04T10:00:00.000Z",
};

const CANDIDATE: ConventionCandidate = {
  id: "c1",
  category: "error-handling",
  rule: "Route handlers return Result<T, ApiError> rather than throwing",
  evidence_path: "src/api/users.ts",
  evidence_start_line: 14,
  evidence_end_line: 20,
  evidence_snippet: "function handler(): Result<Item[], ApiError> {\n  return ok(items);\n}",
  confidence: 0.88,
  status: "pending",
  skill_id: null,
};

function renderCard(over: Partial<Parameters<typeof ConventionCard>[0]> = {}) {
  const props = {
    candidate: CANDIDATE,
    scan: SCAN,
    repoFullName: "acme/payments-api",
    onAccept: vi.fn(),
    onReject: vi.fn(),
    onEdit: vi.fn(),
    ...over,
  };
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ConventionCard {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

describe("ConventionCard", () => {
  it("renders the rule and the snippet verbatim", () => {
    renderCard();
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
    // The snippet was read from the repo and verified — it is shown as-is, not
    // re-wrapped or re-indented.
    expect(screen.getByText(/return ok\(items\);/)).toBeInTheDocument();
  });

  it("links the evidence to GitHub at the cited lines, pinned to the scan SHA", () => {
    // An acceptance criterion: the evidence must be clickable and land on the
    // real code. Pinned to `indexed_sha` rather than a branch, so the lines
    // still hold what the snippet shows after the branch moves on.
    renderCard();
    const link = screen.getByRole("link", { name: "src/api/users.ts:14-20" });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/a1b2c3d4e5f6a7b8/src/api/users.ts#L14-L20",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("collapses a single-line span to one anchor, not L14-L14", () => {
    renderCard({
      candidate: { ...CANDIDATE, evidence_start_line: 14, evidence_end_line: 14 },
    });
    const link = screen.getByRole("link", { name: "src/api/users.ts:14" });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/a1b2c3d4e5f6a7b8/src/api/users.ts#L14",
    );
  });

  it("renders plain text, not a broken link, before a scan exists", () => {
    renderCard({ scan: null });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:14-20")).toBeInTheDocument();
  });

  it("walks pending → accepted → rejected → undo, staying mounted throughout", () => {
    // Reject is a STATE, not a disappearance: it is the one action with no
    // confirmation, so an accidental one has to be recoverable.
    const pending = renderCard();
    expect(screen.getByRole("button", { name: /Accept/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Accept$/ }));
    expect(pending.onAccept).toHaveBeenCalledOnce();
    cleanup();

    renderCard({ candidate: { ...CANDIDATE, status: "accepted" } });
    expect(screen.getByRole("button", { name: /Accepted/ })).toBeInTheDocument();
    cleanup();

    renderCard({ candidate: { ...CANDIDATE, status: "rejected" } });
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Undo reject/ })).toBeInTheDocument();
  });

  it("fires onEdit, so a rule can be corrected before it becomes a skill", () => {
    const props = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    expect(props.onEdit).toHaveBeenCalledOnce();
  });

  it("disables every action while a decision is in flight", () => {
    renderCard({ busy: true });
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });

  it("shows the confidence as a percentage and names the category", () => {
    renderCard();
    expect(screen.getByText("88%")).toBeInTheDocument();
    expect(screen.getByText("error handling")).toBeInTheDocument();
  });
});

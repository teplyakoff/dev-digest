// NOTE — `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
// dependency of this package and every existing test here uses `fireEvent`
// (client/INSIGHTS.md, "Codebase Patterns").
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CreateEvalCaseFromFinding, EvalCaseRecord, FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { ToastProvider } from "../../../../../../../lib/toast";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

/**
 * The eval-case mutation is NOT stubbed — it runs for real over a mocked
 * `fetch`, the shape `BlastRadiusCard.test.tsx` already uses.
 *
 * Stubbing `@/lib/hooks/evals` would have made the provider error below go away
 * with less code and pinned nothing: AC-66's claim is that a click reaches the
 * API and the response's ids come back as a working link. A stub returns
 * whatever the test hands it, so the URL the card builds would be asserted
 * against a fixture the test also wrote.
 */
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(cleanup);

function reply(body: unknown, ok = true, status = 200) {
  fetchMock.mockResolvedValue({
    ok,
    status,
    statusText: ok ? "OK" : "Unprocessable Entity",
    headers: { get: () => "application/json" },
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

function finding(o: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

const FINDINGS: FindingRecord[] = [finding({})];

const MIXED: FindingRecord[] = [
  finding({}),
  finding({ id: "f2", severity: "WARNING", category: "bug", title: "429 without Retry-After" }),
  finding({ id: "f3", severity: "SUGGESTION", category: "style", title: "Extract for readability" }),
];

/**
 * Everything the panel needs above it.
 *
 * `QueryClientProvider` is not optional decoration: the panel calls
 * `useCreateEvalCaseFromFinding`, and without a client the very first render
 * throws "No QueryClient set" — which took out all ten of this file's tests at
 * once when the mutation landed.
 *
 * ONE client for the file, cleared between tests. It has to be stable across
 * `rerender`, because three tests below re-render the panel with a fresh
 * element and a new client identity there would remount the subtree — which is
 * precisely what the deep-link tests are watching for.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

beforeEach(() => queryClient.clear());

function providers(ui: React.ReactNode) {
  return (
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <ToastProvider>{ui}</ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

function renderWithIntl(ui: React.ReactElement) {
  return render(providers(ui));
}

/** A fresh element every time: React bails out of `rerender` when handed the
 *  same reference, and the bail-out reads exactly like a component bug
 *  (client/INSIGHTS.md, 2026-08-03). */
const mixedPanel = (focusFindingId?: string) =>
  providers(<FindingsPanel findings={MIXED} prId="pr1" focusFindingId={focusFindingId} />);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** How late the deep-linked row is made to appear. Real wall clock on purpose:
 *  the point of the fix is that no frame count can predict this number, and 600
 *  ms is both well past the ~330 ms the old 20-frame budget allowed and the same
 *  order as the 791 ms measured in the browser. The suite pays 0.6 s for it. */
const LATE_ROW_MS = 600;

/** Long enough for a scroll to surface if one were coming (one frame + slack). */
const FLUSH_MS = 50;

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

describe("FindingsPanel — severity filter chips", () => {
  it("renders one chip per severity with the review's counts", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    for (const label of ["Critical", "Warning", "Suggestion"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it("clicking a chip hides that severity; clicking again restores it", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    const criticalChip = screen.getByRole("button", { name: /Critical/ });

    fireEvent.click(criticalChip);
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
    expect(screen.getByText("429 without Retry-After")).toBeInTheDocument();
    expect(screen.getByText("Extract for readability")).toBeInTheDocument();

    fireEvent.click(criticalChip);
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("chip counts stay put while filtering (they describe the review, not the view)", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    fireEvent.click(screen.getByRole("button", { name: /Critical/ }));
    // the chip still reports 1 hidden critical
    expect(screen.getByRole("button", { name: /Critical 1/ })).toBeInTheDocument();
  });

  it("all chips off shows the existing no-match empty state", () => {
    renderWithIntl(<FindingsPanel findings={MIXED} prId="pr1" />);
    for (const label of ["Critical", "Warning", "Suggestion"]) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(label) }));
    }
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });

  it("un-filters and expands a deep-linked finding whose severity chip is off", () => {
    // The target is deliberately NOT the first card: `defaultExpanded={i === 0}`
    // would explain an expanded first card on its own, so only a finding further
    // down proves `expandNonce` fired — and its rationale is unique so the
    // expansion is observable.
    const findings = [
      finding({}),
      finding({ id: "f2", severity: "WARNING", title: "429 without Retry-After" }),
      finding({
        id: "f3",
        severity: "SUGGESTION",
        title: "Extract for readability",
        rationale: "The handler is 200 lines long.",
      }),
    ];
    // A fresh element every time: React bails out of `rerender` when handed the
    // same reference, and the bail-out reads exactly like a component bug
    // (client/INSIGHTS.md, 2026-08-03).
    const panel = (focusFindingId?: string) =>
      providers(<FindingsPanel findings={findings} prId="pr1" focusFindingId={focusFindingId} />);

    const view = render(panel());
    fireEvent.click(screen.getByRole("button", { name: /Suggestion/ }));
    expect(screen.queryByText("Extract for readability")).not.toBeInTheDocument();

    // ?finding=f3 arrives from a Smart Diff click while the chip is still off.
    view.rerender(panel("f3"));

    // The panel drops its own filter rather than landing the reader on a list
    // that does not contain the finding they clicked…
    expect(screen.getByText("Extract for readability")).toBeInTheDocument();
    // …and the card is opened, which only the nonce can do at index 2.
    expect(screen.getByText("The handler is 200 lines long.")).toBeInTheDocument();
  });

  it("scrolls to a deep-linked row that only appears long after the first look", async () => {
    // The bug this pins, measured in the live app rather than guessed: the
    // deep-linked card first enters the DOM 791 ms after the click (~47 frames),
    // and the panel's 20-frame budget expired at ~330 ms — `scrollIntoView` was
    // never called once. So the wait is watched, not counted, and this test
    // makes the row appear WELL past any plausible frame budget.
    const view = render(mixedPanel());
    const card = view.container.querySelector('[data-finding-id="f3"]')!;
    const list = card.parentElement!;
    // jsdom implements no scrollIntoView, so the element carries the spy — no
    // prototype polyfill, and no other test inherits one.
    const scrollIntoView = vi.fn();
    Object.assign(card, { scrollIntoView });

    // The row is not in the panel's subtree when `?finding=f3` lands. Detaching
    // the node is the honest stand-in: `[data-finding-id]` inside `rootRef` is
    // the panel's only handle on the row, so "not yet rendered" and "not in this
    // subtree" are the same thing to it.
    card.remove();
    view.rerender(mixedPanel("f3"));
    expect(scrollIntoView).not.toHaveBeenCalled();

    // 600 ms of real time — twice the old ~330 ms budget, the same order as the
    // 791 ms measured in the browser. The panel must still be waiting.
    await sleep(LATE_ROW_MS);
    expect(scrollIntoView).not.toHaveBeenCalled();

    // The row lands. Nothing re-runs the effect here: only the observer on
    // `rootRef` can notice this.
    list.appendChild(card);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });

    // Handled now: toggling a chip while `?finding=` is still in the URL must
    // not scroll the reader back a second time.
    fireEvent.click(screen.getByRole("button", { name: /Warning/ }));
    await sleep(FLUSH_MS);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("does not swallow a miss — a later pass still scrolls to the row", async () => {
    // `handledRef` must be set only where the row was genuinely found. If a miss
    // latched it, the panel would go quiet for that finding forever, and
    // `el?.scrollIntoView?.()` would leave no symptom behind.
    const view = render(mixedPanel());
    const card = view.container.querySelector('[data-finding-id="f3"]')!;
    const list = card.parentElement!;
    const scrollIntoView = vi.fn();
    Object.assign(card, { scrollIntoView });

    card.remove();
    view.rerender(mixedPanel("f3"));
    expect(scrollIntoView).not.toHaveBeenCalled();

    // A chip toggle re-runs the effect, tearing down the observer the missed
    // pass armed. Only a panel that did NOT mark f3 handled arms a new one.
    fireEvent.click(screen.getByRole("button", { name: /Warning/ }));
    list.appendChild(card);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
  });

  it("severity chips compose with the hide-low-confidence toggle", () => {
    const withLowConf = [
      ...MIXED,
      finding({ id: "f4", severity: "WARNING", title: "Shaky guess", confidence: 0.4 }),
    ];
    renderWithIntl(<FindingsPanel findings={withLowConf} prId="pr1" />);
    // hide low confidence first
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.queryByText("Shaky guess")).not.toBeInTheDocument();
    // then filter out criticals — the confident warning remains
    fireEvent.click(screen.getByRole("button", { name: /Critical/ }));
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
    expect(screen.getByText("429 without Retry-After")).toBeInTheDocument();
  });
});

/* ==========================================================================
   SPEC-08 — one click turns a decided finding into an eval case.

   The whole point of the feature is what is NOT here: no confirmation dialog
   between the click and the row (AC-65). The design draws a 920 px modal on
   this path and the criterion overrules it, so "no dialog in the DOM" is an
   assertion rather than a description.
   ========================================================================== */

const DECIDED: FindingRecord[] = [
  finding({ id: "f1", title: "Hardcoded secret", accepted_at: "2026-08-20T10:00:00.000Z" }),
];

function evalCase(o: Partial<EvalCaseRecord> = {}): EvalCaseRecord {
  return {
    id: "case-new",
    owner_kind: "agent",
    owner_id: "agent-7",
    name: "hardcoded-secret",
    input_diff: "@@ -11 +11 @@\n+const k = 'sk_live'",
    input_files: null,
    input_meta: null,
    expected_output: [{ file: "src/config.ts", start_line: 11, end_line: 11 }],
    notes: null,
    expectation: "must_find",
    source_finding_id: "f1",
    ...o,
  };
}

describe("FindingsPanel — one-click eval case (AC-65…AC-68)", () => {
  it("creates the case and shows a success toast linking to it — with no dialog", async () => {
    const created: CreateEvalCaseFromFinding = { case: evalCase(), existing_cases: [] };
    reply(created);
    renderWithIntl(<FindingsPanel findings={DECIDED} prId="pr1" />);

    fireEvent.click(screen.getByRole("button", { name: messages.finding.createEvalCase }));

    // AC-66 — the toast carries a real anchor, not a sentence about one. Scoped
    // to the toast region so the card's own copy of the link (rendered below the
    // actions once the response lands) cannot satisfy this instead.
    const toast = await screen.findByRole("status");
    const link = await within(toast).findByRole("link", { name: messages.finding.editEvalCase });
    // The href is built from the RESPONSE — owner and case id — which is why the
    // mutation is not stubbed: a stub would let the test assert its own fixture.
    expect(link).toHaveAttribute("href", "/agents/agent-7?tab=evals&case=case-new");
    expect(toast).toHaveTextContent(messages.finding.evalCaseCreated);

    // AC-65 — the request went out and nothing opened. `EvalCaseEditor` renders
    // a `role="dialog"`, so its absence is checkable rather than assumed.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/findings/f1/eval-case");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("AC-68 — reports a case that already existed for the same finding", async () => {
    const prior = evalCase({ id: "case-old", name: "hardcoded-secret-v1" });
    reply({ case: evalCase(), existing_cases: [prior] } satisfies CreateEvalCaseFromFinding);
    renderWithIntl(<FindingsPanel findings={DECIDED} prId="pr1" />);

    fireEvent.click(screen.getByRole("button", { name: messages.finding.createEvalCase }));

    const toast = await screen.findByRole("status");
    // A different sentence AND a second link: telling the reader that a case
    // already exists while offering no way to look at it is the failure mode
    // AC-68 names.
    expect(toast).toHaveTextContent(messages.finding.existingEvalCase);
    expect(
      within(toast).getByRole("link", { name: messages.finding.viewEvalCase }),
    ).toHaveAttribute("href", "/agents/agent-7?tab=evals&case=case-old");
  });

  it("AC-67 — surfaces the SERVER's reason on failure, not a generic message", async () => {
    const reason = "This finding's file has no stored patch text.";
    reply({ error: { code: "unprocessable", message: reason } }, false, 422);
    renderWithIntl(<FindingsPanel findings={DECIDED} prId="pr1" />);

    fireEvent.click(screen.getByRole("button", { name: messages.finding.createEvalCase }));

    const toast = await screen.findByRole("status");
    await waitFor(() => expect(toast).toHaveTextContent(reason));
    expect(toast).toHaveTextContent(messages.finding.evalCaseFailed);
    // The bundled fallback copy is for a failure that carried NO message; a
    // panel that showed it here would have thrown the server's reason away.
    expect(toast).not.toHaveTextContent(messages.finding.evalCaseNoDiff);
  });
});

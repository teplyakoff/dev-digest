// NOTE — `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
// dependency of this package and every test here uses `fireEvent`
// (client/INSIGHTS.md, 2026-08-06). Adding it for one click would touch the
// lockfile as a side effect of writing a test.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBriefRecord } from "@devdigest/shared";
// EIGHT levels up from a route-local `_components/<Name>/` folder — the
// specifier is copied from `RunTraceDrawer.test.tsx` rather than counted
// (client/INSIGHTS.md, "Codebase Patterns").
import prReview from "../../../../../../../../messages/en/prReview.json";
// `common` too: the footer reuses `RunCostBadge`, which reads `common.runCost`.
// One namespace renders raw keys.
import common from "../../../../../../../../messages/en/common.json";
import { PrBriefCard } from "./PrBriefCard";

/* WHAT THIS FILE CAN AND CANNOT PROVE. The card is presentational, so every
   prop here is hand-passed — which is exactly the shape client/INSIGHTS.md
   (2026-08-05) warns proves nothing about whether anything passes it. That gap
   is closed one level up: `OverviewTab.test.tsx` renders the same card from
   MOCKED API DATA, and `PrDetailView.test.tsx` pins what the click does to the
   URL. This file owns the card's own rules — what it shows, in what order, and
   what it must never show. */

afterEach(cleanup);

const DERIVED_AT = "2026-08-20T09:15:00Z";

function brief(o: Partial<PrBriefRecord> = {}): PrBriefRecord {
  return {
    pr_id: "pr-1",
    what: "Adds a per-IP rate limiter in front of the public API routes.",
    why: "The public API was knocked over by a scraper on the 3rd.",
    risk_level: "high",
    risks: [
      {
        kind: "availability",
        title: "Limiter shares one in-process counter",
        explanation: "Two API instances would each allow the full quota.",
        severity: "medium",
        file_refs: ["src/middleware/ratelimit.ts"],
      },
      {
        kind: "correctness",
        title: "No allowlist for internal callers",
        explanation: "The cron worker hits the same routes and will be throttled.",
        severity: "high",
        file_refs: ["src/api/public/index.ts"],
      },
      {
        kind: "style",
        title: "Magic number for the window",
        explanation: "60_000 appears twice.",
        severity: "medium",
        file_refs: ["src/middleware/ratelimit.ts"],
      },
    ],
    review_focus: [
      { path: "src/middleware/ratelimit.ts", reason: "the whole limiter lives here" },
      { path: "src/api/public/index.ts", reason: "where it is mounted" },
    ],
    risks_grounded: true,
    dropped_blocks: [],
    unavailable_inputs: [],
    head_sha: "sha-one",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash-0731",
    derived_at: DERIVED_AT,
    tokens_in: 6120,
    tokens_out: 480,
    cost_usd: 0.0021,
    attempts: 1,
    ...o,
  };
}

/** Twenty focus items, so "ten shown" and "twenty in total" are different
 *  numbers — a fixture with ten of them could not tell them apart. */
function twentyFocusItems() {
  return Array.from({ length: 20 }, (_, i) => ({
    path: `src/mod/file-${String(i).padStart(2, "0")}.ts`,
    reason: `reason ${i}`,
  }));
}

/** The two callbacks are always spies — no test needs to supply its own, and a
 *  `props.onOpenFile ?? vi.fn()` union would lose `.mock` to the type checker. */
function renderCard(
  props: Partial<Omit<React.ComponentProps<typeof PrBriefCard>, "onOpenFile" | "onRebuild">> = {},
) {
  const onOpenFile = vi.fn<(path: string) => void>();
  const onRebuild = vi.fn<() => void>();
  const view = render(
    <NextIntlClientProvider locale="en" messages={{ prReview, common }}>
      <PrBriefCard brief={brief()} {...props} onOpenFile={onOpenFile} onRebuild={onRebuild} />
    </NextIntlClientProvider>,
  );
  return { ...view, onOpenFile, onRebuild };
}

describe("PrBriefCard", () => {
  // AC-37 + NFR-7. Colour is the fast channel, the word is the reliable one, so
  // both are asserted: three levels, three DIFFERENT colour tokens, each with a
  // label that says the level in words.
  it("shows the risk level as a word and paints each of the three levels differently", () => {
    const colors: string[] = [];
    for (const [level, label] of [
      ["high", "High risk"],
      ["medium", "Medium risk"],
      ["low", "Low risk"],
    ] as const) {
      renderCard({ brief: brief({ risk_level: level }) });
      const pill = screen.getByText(label);
      // `el.style.color` — the value React specified — never `getComputedStyle`,
      // which in this environment reports pre-transition values
      // (client/INSIGHTS.md, 2026-08-10).
      colors.push(pill.style.color);
      cleanup();
    }
    expect(new Set(colors).size).toBe(3);
    expect(colors.every(Boolean)).toBe(true);
  });

  // AC-38. Two sentences about the change itself, which is the thing the PR
  // title is not.
  it("shows what the change does and why", () => {
    renderCard();
    expect(screen.getByText(/per-IP rate limiter in front of the public API/i)).toBeInTheDocument();
    expect(screen.getByText(/knocked over by a scraper/i)).toBeInTheDocument();
  });

  // AC-45. The fixture is deliberately out of order (medium, high, medium) and
  // carries TWO mediums, so this pins both halves: severity order across groups,
  // and the server's order preserved inside one.
  it("orders risks high → medium → low, keeping the server's order within a severity", () => {
    renderCard();
    const titles = screen
      .getAllByText(/Limiter shares|No allowlist|Magic number/)
      .map((el) => el.textContent);
    expect(titles).toEqual([
      "No allowlist for internal callers",
      "Limiter shares one in-process counter",
      "Magic number for the window",
    ]);
  });

  // AC-46. "No risks" and "we threw away every risk we were given" are opposite
  // meanings that render identically without this line — the same trap
  // `BlastTab` has with `degraded` versus an empty array.
  it("explains that the risks could not be confirmed rather than showing none", () => {
    renderCard({ brief: brief({ risks: [], risks_grounded: false }) });
    expect(screen.getByText(/could not be confirmed against the changed files/i)).toBeInTheDocument();
    // The headline level survives the drop (server AC-12), so it is still here.
    expect(screen.getByText("High risk")).toBeInTheDocument();
  });

  it("does not claim anything about grounding when the risks were confirmed", () => {
    renderCard();
    expect(screen.queryByText(/could not be confirmed/i)).not.toBeInTheDocument();
  });

  // AC-39, AC-40, AC-41. The section lives INSIDE the card — asserted by scoping
  // the query to the card element, not by trusting the layout.
  it("shows at most ten review-focus items inside the card and the real total beside them", () => {
    const { container } = renderCard({ brief: brief({ review_focus: twentyFocusItems() }) });
    const card = container.firstElementChild as HTMLElement;

    const items = within(card).getAllByRole("button", { name: /in the changes tab$/ });
    expect(items).toHaveLength(10);
    // The eleventh item exists in the data and must not be rendered…
    expect(within(card).queryByText("src/mod/file-10.ts")).not.toBeInTheDocument();
    // …and the count must say TWENTY, not ten. A card that reports its own
    // rendered length is a silent truncation.
    expect(within(card).getByText(/Showing 10 of 20 files/)).toBeInTheDocument();
  });

  it("says nothing about a total when every focus item is shown", () => {
    renderCard();
    expect(screen.queryByText(/Showing \d+ of/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /in the changes tab$/ })).toHaveLength(2);
  });

  // NFR-7: the accessible name carries the FULL path, so the control is
  // identifiable without seeing the (ellipsized) label.
  // AC-42, FIRST LINK ONLY — the card hands a path to its caller. Whether
  // anyone listens is `OverviewTab.test.tsx`; what the URL becomes is
  // `PrDetailView.test.tsx`.
  it("hands the file path — and no line number — to the caller when an item is activated", () => {
    const { onOpenFile } = renderCard();
    const item = screen.getByRole("button", {
      name: "Open src/api/public/index.ts in the changes tab",
    });
    fireEvent.click(item);
    expect(onOpenFile.mock.calls).toEqual([["src/api/public/index.ts"]]);
    // The path travels alone: no `:12` sneaked in behind it.
    const [firstCall] = onOpenFile.mock.calls;
    expect(String(firstCall?.[0])).not.toMatch(/:\d+$/);
  });

  // AC-47. Cost and the time it was built — the two numbers that tell a reviewer
  // whether they are reading something fresh and what it cost to get.
  it("shows the cost and the time the brief was built", () => {
    renderCard();
    expect(screen.getByText("$0.0021")).toBeInTheDocument();
    // The locale is jsdom's, so the expected string is computed the same way the
    // component computes it rather than hard-coded (the trap SkillStatsTab.test
    // documents).
    expect(
      screen.getByText(new RegExp(new Date(DERIVED_AT).toLocaleString().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
    ).toBeInTheDocument();
  });

  // AC-49. `null` is UNKNOWN and `0` is free; flattening the first into "$0.00"
  // would report a price nobody paid.
  it("renders an em-dash for an unknown cost, never a zero amount", () => {
    renderCard({ brief: brief({ cost_usd: null }) });
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  // AC-48 and AC-50: both are server-computed flags, and both are absent by
  // default — so each test also pins that the badge is not permanently on.
  it("shows a cached chip only when the response says it was reused", () => {
    renderCard({ reused: true });
    expect(screen.getByText("Cached")).toBeInTheDocument();
    cleanup();
    renderCard({ reused: false });
    expect(screen.queryByText("Cached")).not.toBeInTheDocument();
  });

  it("marks the brief stale only when the PR head has moved past it", () => {
    const STALE = "Built against an older commit";
    renderCard({ stale: true });
    expect(screen.getByText(STALE)).toBeInTheDocument();
    cleanup();
    renderCard({ stale: false });
    expect(screen.queryByText(STALE)).not.toBeInTheDocument();
  });

  // AC-51 + NFR-7. The name matters as much as the button: after this feature
  // the Overview tab carries TWO regeneration controls, and this page has
  // already shipped two controls with one name once (INSIGHTS, 2026-08-10).
  it("offers a rebuild button whose accessible name is not the intent card's", () => {
    const { onRebuild } = renderCard();
    const button = screen.getByRole("button", { name: "Rebuild brief" });
    expect(screen.queryByRole("button", { name: /re-derive/i })).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(onRebuild).toHaveBeenCalledTimes(1);
  });

  // AC-53. A 200 carrying `{brief: null}` is the server's promise (AC-67) that
  // makes this state distinguishable from a failure at all.
  it("asks for the brief to be built when there is none, instead of showing an empty card", () => {
    renderCard({ brief: null });
    expect(screen.getByText(/No brief has been built/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Build brief" })).toBeInTheDocument();
    // No hollow card: the headings of a populated brief are not on screen.
    expect(screen.queryByText("Review focus")).not.toBeInTheDocument();
  });

  // AC-54, at the card's own level: a failed READ is not "never built", so it
  // must not offer the build action. `OverviewTab.test.tsx` proves the tab
  // actually reaches this branch from a failing query.
  it("shows a failed read as its own state, with no build action in it", () => {
    renderCard({ brief: null, error: true, onRetry: vi.fn() });
    expect(screen.getByText(/Couldn't load the brief/i)).toBeInTheDocument();
    expect(screen.queryByText(/No brief has been built/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Build brief" })).not.toBeInTheDocument();
  });

  // The same rule the intent card learned the expensive way: a click landing in
  // the loading window spends a real model call, so the loading branch offers no
  // action AT ALL. Naming one button would let a rename slip a live one back in;
  // zero buttons cannot.
  it("offers no action at all while the brief query is in flight", () => {
    const { container } = renderCard({ brief: undefined, loading: true });
    expect(screen.getByText("PR Brief")).toBeInTheDocument();
    expect(within(container).queryAllByRole("button")).toHaveLength(0);
  });

  // AC-56. The dropped names are QUALIFIED — `context-docs:<doc>` for level 1
  // and `file-stats:numbers` for level 5, which drops the +/− numbers and keeps
  // every path. Rendering a bare block name would tell the reader less than the
  // server knows.
  it("lists the input blocks the token budget dropped", () => {
    renderCard({
      brief: brief({ dropped_blocks: ["context-docs:ARCHITECTURE.md", "file-stats:numbers"] }),
    });
    expect(screen.getByText(/context-docs:ARCHITECTURE\.md, file-stats:numbers/)).toBeInTheDocument();
  });

  it("says nothing about dropped blocks when the whole input fitted", () => {
    renderCard();
    expect(screen.queryByText(/Left out to fit/i)).not.toBeInTheDocument();
  });

  /* AC-57 — THE NON-GOAL, pinned as an assertion. The design mock draws the
     verdict, "6 findings · 2 blockers" and the score ring inside a block
     labelled "PR BRIEF"; all four are `VerdictBanner` props fed by a finished
     review run, which the brief neither reads nor waits for. Merging them was
     rejected, and a rejection nobody tests is a rejection that quietly reverts. */
  it("never shows the review verdict, finding counts, blocker counts or the PR score", () => {
    const { container } = renderCard({ reused: true, stale: true });
    const text = container.textContent ?? "";
    for (const forbidden of [/verdict/i, /finding/i, /blocker/i, /\bscore\b/i]) {
      expect(text).not.toMatch(forbidden);
    }
  });
});

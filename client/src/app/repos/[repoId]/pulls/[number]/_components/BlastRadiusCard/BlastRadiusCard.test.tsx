// NOTE — `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
// dependency of this package and every existing test here uses `fireEvent`.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BlastResponse } from "@devdigest/shared";
import blast from "../../../../../../../../messages/en/blast.json";
import { BlastRadiusCard } from "./BlastRadiusCard";

/**
 * The card in isolation, over a mocked API.
 *
 * Two groups of claims. The STATE ones are about honesty: `degraded` and "no
 * callers found" render from identical empty arrays and mean opposite things, so
 * a test that only checked "the list is empty" would pass on the bug this whole
 * feature exists to avoid — an unindexed repository reporting that nothing calls
 * the changed code.
 *
 * The STRUCTURE ones are about the design (`blast.jsx` in the L02 bundle), and
 * they exist because the first implementation of this card matched none of it:
 * endpoints sat in a global section instead of nested under the symbol they
 * belong to, which broke the one chain the feature is — symbol → callers →
 * endpoints — into three lists that happened to be near each other.
 */

const FULL: BlastResponse = {
  status: "full",
  reason: null,
  changed_files: ["src/middleware/ratelimit.ts"],
  symbols: [
    {
      name: "rateLimit",
      file: "src/middleware/ratelimit.ts",
      kind: "function",
      callers: [
        { file: "src/api/public/index.ts", symbol: "publicRouter", line: 23, rank: 0.9 },
        { file: "src/server.ts", symbol: "app", line: 88, rank: 0.8 },
      ],
      callers_total: 2,
    },
    {
      name: "bucketKey",
      file: "src/middleware/ratelimit.ts",
      kind: "function",
      callers: [{ file: "src/middleware/ratelimit.ts", symbol: "rateLimit", line: 40, rank: 0.9 }],
      callers_total: 1,
    },
  ],
  endpoints: [
    {
      route: "GET /api/public/items",
      file: "src/api/public/index.ts",
      depth: 1,
      via: "src/middleware/ratelimit.ts",
    },
  ],
  crons: [
    {
      name: "reset-rate-buckets (hourly)",
      file: "src/jobs/reset.ts",
      depth: 2,
      via: "src/middleware/ratelimit.ts",
    },
  ],
  indexed_sha: "abc1234def5678",
  counts: { symbols: 2, callers: 3, endpoints: 1 },
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(cleanup);

function reply(body: unknown) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

function renderCard(props: Partial<React.ComponentProps<typeof BlastRadiusCard>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ blast }}>
        <BlastRadiusCard
          prId="pr1"
          repoId="repo1"
          repoFullName="teplyakoff/dev-digest"
          headSha="head9999"
          {...props}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("BlastRadiusCard — the design's structure", () => {
  it("shows the stat row: symbols, callers, endpoints, cron", async () => {
    reply(FULL);
    renderCard();

    await screen.findByText("rateLimit()");
    for (const label of ["symbols", "callers", "endpoints", "cron"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("opens only the FIRST symbol, leaving the rest one click away", async () => {
    reply(FULL);
    renderCard();

    // Symbols arrive sorted by reach, so the open one is the widest-reaching.
    expect(await screen.findByText("src/api/public/index.ts:23")).toBeInTheDocument();
    expect(screen.queryByText("src/middleware/ratelimit.ts:40")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("bucketKey()").closest("button")!);
    expect(screen.getByText("src/middleware/ratelimit.ts:40")).toBeInTheDocument();
  });

  it("NESTS the endpoint and cron chips inside the symbol they belong to", async () => {
    reply(FULL);
    renderCard();

    const header = (await screen.findByText("rateLimit()")).closest("button")!;
    // The chips live in the expanded body, which is the sibling after the
    // header — not in a section of their own further down the card.
    const body = header.nextElementSibling as HTMLElement;
    expect(body).toBeTruthy();
    expect(within(body).getByText("GET /api/public/items")).toBeInTheDocument();
    expect(within(body).getByText("reset-rate-buckets (hourly)")).toBeInTheDocument();

    // Collapsing the symbol takes its downstream with it — which is the whole
    // point of nesting, and would not happen with a global endpoints section.
    fireEvent.click(header);
    expect(screen.queryByText("GET /api/public/items")).not.toBeInTheDocument();
  });

  it("links file:line to the commit the line numbers were computed against", async () => {
    reply(FULL);
    renderCard();

    const link = await screen.findByText("src/api/public/index.ts:23");
    expect(link.closest("a")).toHaveAttribute(
      "href",
      "https://github.com/teplyakoff/dev-digest/blob/abc1234def5678/src/api/public/index.ts#L23",
    );
    // The PR head must not appear in any link: it is a different commit from
    // the one the indexer measured.
    expect(document.body.innerHTML).not.toContain("head9999");
  });

  it("renders file:line as plain text when there is no repo to link into", async () => {
    reply(FULL);
    renderCard({ repoFullName: null });

    const label = await screen.findByText("src/api/public/index.ts:23");
    // `MonoLink` with no href renders a <button> — an affordance that does
    // nothing — so the fallback must not be a MonoLink at all.
    expect(label.closest("a")).toBeNull();
    expect(label.closest("button")).toBeNull();
  });

  it("switches to the graph view and back", async () => {
    reply(FULL);
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "graph" }));
    expect(screen.getByRole("img", { name: blast.graph.ariaLabel })).toBeInTheDocument();
    // The tree's caller rows are gone while the graph is up.
    expect(screen.queryByText("src/api/public/index.ts:23")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "tree" }));
    expect(screen.getByText("src/api/public/index.ts:23")).toBeInTheDocument();
  });

  it("hides the view switch when there is nothing to graph", async () => {
    reply({
      ...FULL,
      symbols: [{ ...FULL.symbols[0], callers: [], callers_total: 0 }, FULL.symbols[1]],
    });
    renderCard();

    await screen.findByText("rateLimit()");
    // A Graph tab that can only draw one lonely node is a dead control — but
    // `bucketKey` still has a caller, so this asserts the real condition.
    expect(screen.getByRole("button", { name: "graph" })).toBeInTheDocument();

    cleanup();
    reply({ ...FULL, symbols: FULL.symbols.map((s) => ({ ...s, callers: [], callers_total: 0 })) });
    renderCard();
    await screen.findByText("rateLimit()");
    expect(screen.queryByRole("button", { name: "graph" })).not.toBeInTheDocument();
  });

  it("keeps a route reached from a file with no tracked symbol, rather than dropping it", async () => {
    reply({
      ...FULL,
      endpoints: [
        { route: "GET /orphan", file: "src/other.ts", depth: 1, via: "docs/only-a-readme.md" },
      ],
    });
    renderCard();

    // It cannot hang under any symbol, so it gets its own group instead of
    // disappearing because the tree had nowhere to put it.
    expect(await screen.findByText("GET /orphan")).toBeInTheDocument();
    expect(screen.getByText(blast.elsewhere)).toBeInTheDocument();
  });
});

describe("BlastRadiusCard — states", () => {
  it("offers Re-analyze when there is no index, and does NOT claim there are no callers", async () => {
    reply({
      ...FULL,
      status: "degraded",
      reason: "This repository has not been indexed yet.",
      symbols: [],
      endpoints: [],
      crons: [],
      counts: { symbols: 0, callers: 0, endpoints: 0 },
    });
    renderCard();

    expect(await screen.findByText(blast.degraded.title)).toBeInTheDocument();
    expect(screen.getByText("This repository has not been indexed yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: blast.degraded.action })).toBeInTheDocument();
    // THE ASSERTION THAT MATTERS: "nothing calls this" is a claim about the
    // code, and an unindexed repository has not earned it.
    expect(screen.queryByText(blast.empty.noCallers)).not.toBeInTheDocument();
  });

  it("issues the resync against the repo when Re-analyze is pressed", async () => {
    reply({ ...FULL, status: "degraded", reason: "not indexed", symbols: [], endpoints: [] });
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: blast.degraded.action }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/repos/repo1/resync") &&
            (init as RequestInit | undefined)?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("warns on a partial index but still renders the map", async () => {
    reply({ ...FULL, status: "partial", reason: "The index for this repository is incomplete." });
    renderCard();

    expect(await screen.findByText(blast.partial.title)).toBeInTheDocument();
    expect(screen.getByText("The index for this repository is incomplete.")).toBeInTheDocument();
    // Half a map with a caveat beats no map.
    expect(screen.getByText("rateLimit()")).toBeInTheDocument();
  });

  it("says so plainly when a complete index found nothing", async () => {
    reply({
      ...FULL,
      symbols: [],
      endpoints: [],
      crons: [],
      counts: { symbols: 0, callers: 0, endpoints: 0 },
    });
    renderCard();

    expect(await screen.findByText(blast.empty.noCallers)).toBeInTheDocument();
    expect(screen.queryByText(blast.degraded.title)).not.toBeInTheDocument();
  });

  it("says 'showing 2 of 63' when the server capped the symbol list", async () => {
    reply({ ...FULL, counts: { ...FULL.counts, symbols: 63 } });
    renderCard();
    expect(await screen.findByText(/showing 2 of 63/)).toBeInTheDocument();
  });

  it("shows the retry state when the endpoint itself fails", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    renderCard();
    expect(await screen.findByText(blast.error.title)).toBeInTheDocument();
  });
});

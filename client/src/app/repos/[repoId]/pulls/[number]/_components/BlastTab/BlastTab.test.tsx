// NOTE — `fireEvent`, not `userEvent`: `@testing-library/user-event` is not a
// dependency of this package and every existing test here uses `fireEvent`.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BlastResponse } from "@devdigest/shared";
import blast from "../../../../../../../../messages/en/blast.json";
import { BlastTab } from "./BlastTab";

/**
 * The tab in isolation, over a mocked API — the three states a reviewer can
 * land on, and the link that is the feature's only interaction.
 *
 * The state assertions are the point. `degraded` and "no callers found" render
 * from the same empty arrays and mean opposite things, so a test that only
 * checked "the list is empty" would pass on the bug this feature exists to
 * avoid: an unindexed repository reporting that nothing calls the changed code.
 */

const FULL: BlastResponse = {
  status: "full",
  reason: null,
  changed_files: ["server/src/modules/repos/helpers.ts"],
  symbols: [
    {
      name: "toRepoDto",
      file: "server/src/modules/repos/helpers.ts",
      kind: "function",
      callers: [
        { file: "server/src/modules/repos/service.ts", symbol: "add", line: 92, rank: 0.9 },
        { file: "server/src/modules/repos/service.ts", symbol: "list", line: 107, rank: 0.9 },
      ],
      callers_total: 2,
    },
    {
      name: "parseRepoUrl",
      file: "server/src/modules/repos/helpers.ts",
      kind: "function",
      callers: [],
      callers_total: 0,
    },
  ],
  endpoints: [
    {
      route: "POST /repos",
      file: "server/src/modules/repos/routes.ts",
      depth: 0,
      via: "server/src/modules/repos/routes.ts",
    },
    {
      route: "GET /repos/:id",
      file: "server/src/modules/repos/routes.ts",
      depth: 2,
      via: "server/src/modules/repos/helpers.ts",
    },
  ],
  crons: [],
  indexed_sha: "abc1234def5678",
  counts: { symbols: 2, callers: 2, endpoints: 2 },
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

function renderTab(props: Partial<React.ComponentProps<typeof BlastTab>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ blast }}>
        <BlastTab
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

describe("BlastTab — the map", () => {
  it("renders each changed symbol with its callers", async () => {
    reply(FULL);
    renderTab();

    expect(await screen.findByText("toRepoDto")).toBeInTheDocument();
    expect(screen.getByText("parseRepoUrl")).toBeInTheDocument();
    // Callers are open by default — they are the answer, not a detail.
    expect(screen.getByText("server/src/modules/repos/service.ts:92")).toBeInTheDocument();
    expect(screen.getByText("server/src/modules/repos/service.ts:107")).toBeInTheDocument();
  });

  /**
   * Pinned to `indexed_sha`, NOT to the PR head, and the two really do differ:
   * the head is branched from an older main, while every line number in this
   * map was computed by the indexer against the commit it indexed. A link on
   * the head sha lands on whatever now occupies that line — which agrees with
   * the truth exactly when the caller's file is untouched between the two, so
   * the bug hides in the demo and appears on a file that moved.
   */
  it("links file:line to the commit the line numbers were computed against", async () => {
    reply(FULL);
    renderTab();

    const link = await screen.findByText("server/src/modules/repos/service.ts:92");
    expect(link.closest("a")).toHaveAttribute(
      "href",
      "https://github.com/teplyakoff/dev-digest/blob/abc1234def5678/server/src/modules/repos/service.ts#L92",
    );
    expect(link.closest("a")).toHaveAttribute("target", "_blank");
    // The head sha must not appear in any link on this tab.
    expect(document.body.innerHTML).not.toContain("head9999");
  });

  it("renders file:line as plain text when there is no repo to link into", async () => {
    reply(FULL);
    renderTab({ repoFullName: null });

    const label = await screen.findByText("server/src/modules/repos/service.ts:92");
    // `MonoLink` with no href renders a <button>, which would offer a click
    // that does nothing — so the fallback must not be a MonoLink at all.
    expect(label.closest("a")).toBeNull();
    expect(label.closest("button")).toBeNull();
  });

  it("separates an endpoint the PR changes directly from one it can only reach", async () => {
    reply(FULL);
    renderTab();

    expect(await screen.findByText("POST /repos")).toBeInTheDocument();
    expect(screen.getByText("GET /repos/:id")).toBeInTheDocument();
    expect(screen.getByText(blast.depth.direct)).toBeInTheDocument();
    expect(screen.getByText("2 hops downstream")).toBeInTheDocument();
  });

  it("collapses and expands a symbol's callers", async () => {
    reply(FULL);
    renderTab();

    const header = (await screen.findByText("toRepoDto")).closest("button")!;
    fireEvent.click(header);
    expect(screen.queryByText("server/src/modules/repos/service.ts:92")).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.getByText("server/src/modules/repos/service.ts:92")).toBeInTheDocument();
  });
});

describe("BlastTab — states", () => {
  it("offers Re-analyze when there is no index, and does NOT claim there are no callers", async () => {
    reply({
      ...FULL,
      status: "degraded",
      reason: "This repository has not been indexed yet.",
      symbols: [],
      endpoints: [],
      counts: { symbols: 0, callers: 0, endpoints: 0 },
    });
    renderTab();

    expect(await screen.findByText(blast.degraded.title)).toBeInTheDocument();
    expect(screen.getByText("This repository has not been indexed yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: blast.degraded.action })).toBeInTheDocument();
    // THE ASSERTION THAT MATTERS: "nothing calls this" is a claim about the
    // code, and an unindexed repository has not earned it.
    expect(screen.queryByText(blast.empty.noCallers)).not.toBeInTheDocument();
  });

  it("issues the resync against the repo when Re-analyze is pressed", async () => {
    reply({ ...FULL, status: "degraded", reason: "not indexed", symbols: [], endpoints: [] });
    renderTab();

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
    renderTab();

    expect(await screen.findByText(blast.partial.title)).toBeInTheDocument();
    expect(screen.getByText("The index for this repository is incomplete.")).toBeInTheDocument();
    // Half a map with a caveat beats no map: the symbols are still there.
    expect(screen.getByText("toRepoDto")).toBeInTheDocument();
  });

  it("says so plainly when a complete index found nothing downstream", async () => {
    reply({
      ...FULL,
      status: "full",
      reason: null,
      symbols: [],
      endpoints: [],
      counts: { symbols: 0, callers: 0, endpoints: 0 },
    });
    renderTab();

    expect(await screen.findByText(blast.empty.noCallers)).toBeInTheDocument();
    expect(screen.queryByText(blast.degraded.title)).not.toBeInTheDocument();
  });

  it("shows the retry state when the endpoint itself fails", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    renderTab();
    expect(await screen.findByText(blast.error.title)).toBeInTheDocument();
  });
});

describe("BlastTab — caller cap", () => {
  it("says '20 of 47' only when the list was actually capped", async () => {
    reply({
      ...FULL,
      symbols: [{ ...FULL.symbols[0], callers_total: 47 }],
    });
    renderTab();
    expect(await screen.findByText(/showing 2 of 47/)).toBeInTheDocument();
  });

  it("says 'showing 2 of 63' when the SERVER capped the symbol list", async () => {
    reply({ ...FULL, counts: { ...FULL.counts, symbols: 63 } });
    renderTab();
    // `counts` are totals for the whole map, `symbols` is the capped array —
    // the gap between them is the only thing that keeps a truncated list from
    // reading as a complete one.
    expect(await screen.findByText(/showing 2 of 63 changed symbols/)).toBeInTheDocument();
  });

  it("says nothing about capping when the map fits", async () => {
    reply(FULL);
    renderTab();
    await screen.findByText("toRepoDto");
    expect(screen.queryByText(/changed symbols/)).not.toBeInTheDocument();
  });

  it("carries no qualifier when the list is complete", async () => {
    reply(FULL);
    renderTab();
    await screen.findByText("toRepoDto");
    expect(screen.queryByText(/showing/)).not.toBeInTheDocument();
  });
});

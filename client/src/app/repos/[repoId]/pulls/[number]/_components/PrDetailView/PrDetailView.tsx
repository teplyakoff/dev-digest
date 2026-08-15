/* PR Detail view — everything the /repos/:repoId/pulls/:number route does.
   - Findings panel (VerdictBanner + FindingCards)
   - RunReviewDropdown (run all / a specific agent) + live SSE RunStatus
   - File-by-file diff viewer in the Files tab
   Tab state lives in the query string (?tab). */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { PrDetailHeader } from "../PrDetailHeader";
import { OverviewTab } from "../OverviewTab";
import { FindingsTab } from "../FindingsTab";
import { DiffTab } from "../DiffTab";
import RunTraceDrawer from "../RunTraceDrawer";
import { usePullDetail, usePulls } from "@/lib/hooks";
import {
  usePrReviews,
  useCancelRun,
  usePrActiveRuns,
  usePrRuns,
  useDeleteRun,
  useInvalidatePrRuns,
} from "@/lib/hooks/reviews";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { githubPrUrl } from "@/lib/github-urls";
import type { FindingRecord } from "@devdigest/shared";
import { s } from "./styles";

/**
 * Extracted from `page.tsx`, which had grown to eight hooks, tab state, URL
 * parsing, four handlers and three tab bodies. A page binds a URL to a view and
 * holds nothing else (nextjs.md §4): everything here would have to be rewritten
 * to point the same feature at a different URL, which is exactly the test.
 */
export function PrDetailView() {
  const params = useParams<{ repoId: string; number: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { repoId, number } = params;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  // The route is keyed by PR number, but every PR API is keyed by the row's
  // uuid — resolve number → uuid via the (cached) pulls list before fetching.
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const prId = pulls?.find((p) => p.number === Number(number))?.id ?? null;
  const { data: pr, isLoading: detailLoading, isError, error, refetch } = usePullDetail(prId);

  const isLoading = pullsLoading || (prId != null && detailLoading);
  const { data: reviews, refetch: refetchReviews } = usePrReviews(prId);

  // Live run tracking is SERVER-SOURCED (agent_runs status='running'): survives
  // navigation AND reload, and self-clears via polling when runs finish.
  const { data: activeRuns } = usePrActiveRuns(prId);
  const { data: prRuns } = usePrRuns(prId);
  const deleteRun = useDeleteRun(prId);
  const liveRunIds = (activeRuns ?? []).map((r) => r.run_id);
  const reviewRunning = liveRunIds.length > 0;
  const cancel = useCancelRun();
  // Named invalidators from the module that owns those cache keys — this view
  // never retypes them (frontend-architecture §10).
  const invalidateRuns = useInvalidatePrRuns(prId);

  const tab = search.get("tab") ?? "overview";
  const traceRunId = search.get("trace");
  /**
   * Merge a whole patch of query params in ONE navigation.
   *
   * Opening a finding sets `tab` and `finding` together, and calling a one-key
   * setter twice races: both calls read `search` from the same render's closure,
   * so the second navigation overwrites the first. The tell is a URL with
   * `finding` but no `tab` (or the reverse), depending on render timing.
   *
   * `history` chooses what that one navigation does to the back stack, and the
   * two kinds of URL change here genuinely differ:
   *
   * - `"replace"` (the default) for a VIEW PREFERENCE that the reviewer stays
   *   put for — the Smart/Original toggle, the tab, the trace drawer. Pushing on
   *   the toggle would make Back an undo log of clicks on the same screen.
   * - `"push"` for a real DESTINATION. The finding click leaves the Files tab
   *   for `?tab=findings&finding=<id>`; replacing there overwrites the entry the
   *   reviewer came from, so Back skips the Files tab entirely instead of
   *   returning them to `?tab=diff&view=smart`. Verified in a live browser.
   */
  const setParams = (
    patch: Record<string, string | null>,
    opts: { history?: "push" | "replace" } = {},
  ) => {
    const sp = new URLSearchParams(search.toString());
    for (const [key, val] of Object.entries(patch)) {
      if (val == null) sp.delete(key);
      else sp.set(key, val);
    }
    const href = `/repos/${repoId}/pulls/${number}${sp.toString() ? `?${sp.toString()}` : ""}`;
    if (opts.history === "push") router.push(href);
    else router.replace(href);
  };
  // Unchanged for its existing callers: one key, replaced, never pushed.
  const setParam = (key: string, val: string | null) => setParams({ [key]: val });
  const setTab = (t: string) => setParam("tab", t);

  // Files-tab ordering lives in the URL, not in component state: the
  // click-through navigates AWAY to `?tab=findings`, and with local state
  // pressing Back would return the reviewer to the Files tab in Original order
  // — the mode silently lost on the feature's most-used interaction. Absent
  // `view` means smart, so a reviewer lands on the sorted diff.
  const diffView = search.get("view") === "original" ? "original" : "smart";
  // `?finding=<id>` is the whole click-through: which finding to open, resolved
  // to its owning run from data this view already holds.
  const focusFindingId = search.get("finding");

  // Reviews come newest-first; each is its own run (grouped into accordions).
  const runs = reviews ?? [];
  // Derived in render, never stored: which run owns the finding the URL names.
  const focusRunId =
    (focusFindingId && runs.find((r) => r.findings.some((f) => f.id === focusFindingId))?.run_id) ||
    null;
  const allFindings: FindingRecord[] = runs.flatMap((r) => r.findings);
  const lethalTrifecta = allFindings.filter((f) => f.kind === "lethal_trifecta");
  const findingsCount = allFindings.length;

  const repoName = activeRepo?.full_name ?? repoId;
  // The real "owner/repo" (null until the repo is loaded) — used to build
  // github.com deep-links for the header and finding file references.
  const repoFullName = activeRepo?.full_name ?? null;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: "Pull Requests", href: `/repos/${repoId}/pulls` },
    { label: `#${number}`, mono: true },
  ];

  // Stale/unknown :repoId → friendly empty state instead of a 404 error.
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.loadingStack}>
          <Skeleton height={28} width={420} />
          <Skeleton height={16} width={300} />
          <Skeleton height={200} />
        </div>
      </AppShell>
    );
  }

  if (isError || !pr) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title="Couldn't load this pull request"
          body={error instanceof ApiError ? error.message : `PR #${number} could not be loaded.`}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <PrDetailHeader
        pr={pr}
        prId={prId}
        tab={tab}
        findingsCount={findingsCount}
        githubUrl={repoFullName ? githubPrUrl(repoFullName, pr.number) : null}
        onSetTab={setTab}
        onRunStart={() => setTab("findings")}
        onRunsStarted={() => invalidateRuns.active()}
      />

      <div style={s.body}>
        {tab === "overview" && (
          <OverviewTab
            prId={prId}
            prBody={pr.body}
            headSha={pr.head_sha}
            repoId={repoId}
            repoFullName={repoFullName}
          />
        )}

        {tab === "findings" && (
          <FindingsTab
            prId={prId}
            liveRunIds={liveRunIds}
            reviewRunning={reviewRunning}
            lethalTrifecta={lethalTrifecta}
            runs={runs}
            prRuns={prRuns}
            prCommits={pr.commits}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
            cancelMutation={cancel}
            focusFindingId={focusFindingId}
            focusRunId={focusRunId}
            onOpenTrace={(id) => setParam("trace", id)}
            onDelete={(id) => {
              if (window.confirm("Delete this run from history? (its logs are removed too)"))
                deleteRun.mutate(id);
            }}
            onRunDone={() => {
              invalidateRuns.active();
              // A settled run (done OR failed) must appear in "Run history"
              // immediately, with no page reload.
              invalidateRuns.history();
              // The run derived the intent as shared pre-work, so the Overview
              // card may be showing a state the run has already replaced. That
              // tab is unmounted while this fires — the invalidation is what
              // makes it refetch on the way back rather than serve the
              // pre-run value from cache.
              invalidateRuns.intent();
              // The run produced findings, and Smart Diff joins EVERY stored
              // review's findings onto the file list — so its badges and line
              // rails must appear with no page reload.
              invalidateRuns.smartDiff();
              refetchReviews();
            }}
          />
        )}

        {tab === "diff" && (
          <DiffTab
            prId={prId}
            filesCount={pr.files_count}
            files={pr.files}
            canComment={pr.status === "open"}
            view={diffView}
            // REPLACE: the toggle is a view preference on the screen the
            // reviewer is already on, not somewhere they navigated to.
            onSetView={(v) => setParam("view", v)}
            // Tab AND finding in ONE navigation — see `setParams` above — and a
            // PUSH, so Back comes back to `?tab=diff&view=smart`.
            onOpenFinding={(id) => setParams({ tab: "findings", finding: id }, { history: "push" })}
          />
        )}
      </div>

      {prId && traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          prNumber={pr.number}
          findings={runs.find((r) => r.run_id === traceRunId)?.findings ?? []}
          agentName={runs.find((r) => r.run_id === traceRunId)?.agent_name ?? null}
          onClose={() => setParam("trace", null)}
        />
      )}
    </AppShell>
  );
}

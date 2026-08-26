"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
// Direct module import, not a folder barrel: the IntentCard folder deliberately
// ships no `index.ts` (frontend-architecture §12 forbids new barrels).
import { IntentCard } from "../IntentCard/IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard/BlastRadiusCard";
import { PrBriefCard } from "../PrBriefCard/PrBriefCard";
import { usePullIntent, useRecalculateIntent } from "@/lib/hooks/intent";
import { usePrBrief, useRebuildBrief } from "@/lib/hooks/brief";
import { notify } from "@/lib/toast";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  /** The PR's current head — the intent card compares it to decide "stale". */
  headSha?: string | null;
  /** The repo row id — Blast Radius issues "Re-analyze" against it. */
  repoId: string;
  /** `owner/repo`, or null until the repo is loaded. */
  repoFullName: string | null;
  /**
   * Open this file in the changes tab. The tab does NOT navigate itself: the
   * URL — which tab, which view, which file — is `PrDetailView`'s to own, and
   * one component writing query params that another component also writes is
   * how the two-setter race in `setParams` was born.
   */
  onOpenFile: (path: string) => void;
}

/**
 * The PR's Overview: how risky the change is and what to read first (the brief),
 * then what the author says it does and what the Intent Layer derived from that.
 *
 * BOTH cards' data lives HERE rather than inside them, which keeps them
 * presentational — props in, JSX out — and is what lets `OverviewTab.test.tsx`
 * assert each renders from MOCKED API DATA rather than from a hand-passed prop
 * (client/INSIGHTS.md, 2026-08-05).
 *
 * The tab also owns NEITHER navigation: `onOpenFile` goes straight up to
 * `PrDetailView`, which is the only component that writes this route's query
 * string.
 */
export function OverviewTab({
  prId,
  prBody,
  headSha,
  repoId,
  repoFullName,
  onOpenFile,
}: OverviewTabProps) {
  const t = useTranslations("prReview");
  const intentQuery = usePullIntent(prId);
  const recalculate = useRecalculateIntent(prId);
  const handleRecalculate = React.useCallback(() => {
    recalculate.mutate();
  }, [recalculate]);

  // The brief's hooks live HERE for the same reason the intent's do: the card
  // stays presentational, and the wiring becomes visible to a test that renders
  // this tab from mocked API data.
  const briefQuery = usePrBrief(prId);
  const rebuild = useRebuildBrief(prId);
  const handleRebuild = React.useCallback(() => {
    rebuild.mutate(undefined, {
      // A rebuild is a PAID action, so a failure that says nothing invites a
      // second click and a second bill. The previous brief stays on screen
      // either way — a failed mutation writes nothing to the cache.
      onError: (err: unknown) =>
        notify.error(err instanceof Error ? err.message : t("brief.rebuildFailed")),
    });
  }, [rebuild, t]);

  return (
    <>
      {/* Overview is the DEFAULT tab (`?tab` absent → overview), so the derived
          intent is the first thing a reviewer reads — before the diff and before
          any findings, which is the point of the feature. It used to sit at the
          top of `?tab=findings` because Overview rendered only `pr.body` and
          looked empty; that is now the wrong trade, and the tab it left behind
          opens on the Timeline as it did before L03. */}
      {/* ABOVE the Intent / Blast pair, not beside it (AC-36): the risk level and
          the reading order are what a reviewer needs before either of the two
          cards below, and the pair keeps its own grid untouched. */}
      <PrBriefCard
        brief={briefQuery.data?.brief}
        // `isLoading`, not `isPending`: with no `prId` the query is disabled and
        // stays pending forever, which would pin the card in its skeleton — and
        // its skeleton is the branch with no build button in it.
        loading={briefQuery.isLoading}
        error={briefQuery.isError}
        onRetry={() => briefQuery.refetch()}
        stale={briefQuery.data?.stale}
        reused={briefQuery.data?.reused}
        onRebuild={handleRebuild}
        rebuilding={rebuild.isPending}
        onOpenFile={onOpenFile}
      />

      {/* THE BRIEF, as two cards side by side — the design's `BriefCard` grid
          (`screen_pr_detail.jsx`): what the change is FOR on the left, what it
          can REACH on the right. `auto-fit` rather than the design's literal
          `1fr 1fr` so the pair stacks instead of squeezing on a narrow window;
          at the design's width it resolves to the same two columns. */}
      <div style={s.briefGrid}>
        <IntentCard
          intent={intentQuery.data?.intent}
          // `isLoading`, not `isPending`: with no `prId` the query is disabled
          // and stays pending forever, which would pin the card in its
          // skeleton. This is true only while a request is actually in flight.
          loading={intentQuery.isLoading}
          headSha={headSha}
          onDerive={handleRecalculate}
          deriving={recalculate.isPending}
        />
        <BlastRadiusCard
          prId={prId}
          repoId={repoId}
          repoFullName={repoFullName}
          headSha={headSha ?? ""}
        />
      </div>

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}

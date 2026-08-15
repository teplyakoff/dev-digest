"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
// Direct module import, not a folder barrel: the IntentCard folder deliberately
// ships no `index.ts` (frontend-architecture §12 forbids new barrels).
import { IntentCard } from "../IntentCard/IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard/BlastRadiusCard";
import { usePullIntent, useRecalculateIntent } from "@/lib/hooks/intent";
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
}

/**
 * The PR's Overview: what the author says it does, and what the Intent Layer
 * derived from that.
 *
 * The intent card's data lives HERE rather than inside `IntentCard`, which keeps
 * that component presentational — props in, JSX out — and is what lets
 * `OverviewTab.test.tsx` assert the card renders from MOCKED API DATA rather
 * than from a hand-passed prop.
 */
export function OverviewTab({ prId, prBody, headSha, repoId, repoFullName }: OverviewTabProps) {
  const intentQuery = usePullIntent(prId);
  const recalculate = useRecalculateIntent(prId);
  const handleRecalculate = React.useCallback(() => {
    recalculate.mutate();
  }, [recalculate]);

  return (
    <>
      {/* Overview is the DEFAULT tab (`?tab` absent → overview), so the derived
          intent is the first thing a reviewer reads — before the diff and before
          any findings, which is the point of the feature. It used to sit at the
          top of `?tab=findings` because Overview rendered only `pr.body` and
          looked empty; that is now the wrong trade, and the tab it left behind
          opens on the Timeline as it did before L03. */}
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

"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
// Direct module import, not a folder barrel: the IntentCard folder deliberately
// ships no `index.ts` (frontend-architecture §12 forbids new barrels).
import { IntentCard } from "../IntentCard/IntentCard";
import { usePullIntent, useRecalculateIntent } from "@/lib/hooks/intent";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  /** The PR's current head — the card compares it to decide "stale". */
  headSha?: string | null;
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
export function OverviewTab({ prId, prBody, headSha }: OverviewTabProps) {
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
      <IntentCard
        intent={intentQuery.data?.intent}
        // `isLoading`, not `isPending`: with no `prId` the query is disabled and
        // stays pending forever, which would pin the card in its skeleton. This
        // is true only while a request is actually in flight.
        loading={intentQuery.isLoading}
        headSha={headSha}
        onDerive={handleRecalculate}
        deriving={recalculate.isPending}
      />

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}

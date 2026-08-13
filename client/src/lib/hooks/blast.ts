/* hooks/blast.ts — React Query hook for the L04 Blast Radius map.

   Its own domain file rather than a corner of `reviews.ts`, mirroring the
   server, where blast is `modules/blast/` and not part of `modules/reviews`.
   Deliberately NOT re-exported from `hooks/index.ts`: the barrel's five
   `export *` lines are baselined, a sixth is a fresh lint error, and the fix is
   to import this module directly (`@/lib/hooks/blast`) — see `INSIGHTS.md`,
   2026-08-10. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastResponse } from "@devdigest/shared";

type PrId = string | null | undefined;

/** Query keys stay PRIVATE to this module (frontend-architecture §10). */
const keys = {
  blast: (prId: PrId) => ["pr-blast", prId] as const,
};

/**
 * The PR's impact map.
 *
 * Always a 200: "there is no index" arrives as `status: "degraded"` with a
 * `reason`, never as an error status the caller has to decode. So an `isError`
 * here means the request itself failed, and the three states of the map are
 * read off `data.status` — which is what lets the tab tell "nothing calls this"
 * apart from "we do not know what calls this".
 *
 * `staleTime` is 5 minutes because the answer only moves when the repository is
 * re-indexed, which is a manual action on another page. Refetching it on every
 * tab focus would re-issue four database reads to redraw the same tree.
 */
export function usePrBlast(prId: PrId) {
  return useQuery({
    queryKey: keys.blast(prId),
    queryFn: () => api.get<BlastResponse>(`/pulls/${prId}/blast`),
    enabled: !!prId,
    staleTime: 5 * 60 * 1000,
  });
}

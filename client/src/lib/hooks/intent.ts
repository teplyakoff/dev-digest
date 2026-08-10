/* hooks/intent.ts — React Query hooks for the L03 Intent Layer.

   Its own domain file rather than a corner of `reviews.ts`, mirroring the
   server, where intent is `modules/intent/` and not part of `modules/reviews`.
   The two are joined only at the point a review run derives intent as shared
   pre-work, and that join is expressed the sanctioned way: `reviews.ts` imports
   the NAMED INVALIDATOR below, never this module's query key — the same shape
   `skills.ts` uses to reach `invalidateAgents`. */
"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { PrIntentView } from "@devdigest/shared";

type PrId = string | null | undefined;

/**
 * Query keys stay PRIVATE to this module (frontend-architecture §10). A caller
 * that must invalidate says what changed through `invalidatePrIntent`; it never
 * retypes a key.
 */
const keys = {
  intent: (prId: PrId) => ["pr-intent", prId] as const,
};

/**
 * The PR's derived intent. `{intent: null}` before the first derivation — a 200
 * with a null, never a 404, so the card renders its empty state without the
 * caller having to read a status code.
 */
export function usePullIntent(prId: PrId) {
  return useQuery({
    queryKey: keys.intent(prId),
    queryFn: () => api.get<PrIntentView>(`/pulls/${prId}/intent`),
    enabled: !!prId,
  });
}

/**
 * Derive the intent now — the first time, or again over a PR whose head has
 * moved since (which is what the card's "stale" badge is telling the reader).
 *
 * The response IS the new view, so it goes straight into the cache rather than
 * invalidating — the same call `useExtractConventions` makes, for the same
 * reason: invalidating would flash the card back through its loading state
 * immediately after the user watched it finish.
 */
export function useRecalculateIntent(prId: PrId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrIntentView>(`/pulls/${prId}/intent`),
    onSuccess: (data) => qc.setQueryData(keys.intent(prId), data),
  });
}

/**
 * "A review run finished, so the intent may have been (re-)derived by it."
 *
 * The review path derives intent as SHARED PRE-WORK (`run-executor.ts`, before
 * the agent loop), so the first review on a PR that had no intent produces one
 * this page never asked for. Without this invalidation the card keeps rendering
 * its empty state until a manual reload — a stale value that looks right, which
 * a demo surfaces and a test does not (`client/INSIGHTS.md` 2026-08-05).
 */
export function invalidatePrIntent(qc: QueryClient, prId: PrId): void {
  if (prId) qc.invalidateQueries({ queryKey: keys.intent(prId) });
}

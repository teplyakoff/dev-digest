/* hooks/brief.ts — React Query hooks for the L05 PR Why + Risk Brief.

   Its own domain file rather than a corner of `reviews.ts`, mirroring the
   server, where the brief is `modules/brief/` and not part of `modules/reviews`.
   Deliberately NOT re-exported from `hooks/index.ts`: the barrel's five
   `export *` lines are baselined, a sixth is a fresh `no-restricted-syntax`
   error ("No new barrel files — frontend-architecture §12") and `pnpm lint`
   fails — the baseline working as designed. Import this module directly
   (`@/lib/hooks/brief`), the way `blast.ts` and `intent.ts` are imported. */
"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "../api";
// TYPE-ONLY, and it is a budget line rather than a style: one VALUE import from
// `@devdigest/shared` drags the whole `export *` barrel plus `zod` into the
// shared chunk — ~15 kB First Load JS on EVERY route, measured
// (client/INSIGHTS.md, 2026-08-03). NFR-6 holds the shared chunk at 102 kB.
import type { PrBriefView } from "@devdigest/shared";

type PrId = string | null | undefined;

/**
 * Query keys stay PRIVATE to this module (frontend-architecture §10). A caller
 * that must invalidate says what changed through `invalidatePrBrief`; it never
 * retypes a key.
 */
const keys = {
  brief: (prId: PrId) => ["pr-brief", prId] as const,
};

/**
 * The PR's brief. `{brief: null}` before the first build — a 200 with a null,
 * never a 404 (server AC-67), which is what lets the card tell "never built"
 * apart from "the request failed" without decoding a status code.
 *
 * READ NEVER BUILDS. `GET` returns what is stored and spends nothing; the model
 * call happens only on the `POST` below, so mounting the Overview tab is free.
 */
export function usePrBrief(prId: PrId) {
  return useQuery({
    queryKey: keys.brief(prId),
    queryFn: () => api.get<PrBriefView>(`/pulls/${prId}/brief`),
    enabled: !!prId,
  });
}

/**
 * Build (or rebuild) the brief now. THIS ONE SPENDS MONEY — one model call, two
 * on a PR whose intent has to be derived first — so it is a mutation fired from
 * a click, never from mounting.
 *
 * The response IS the new view, so it goes straight into the cache rather than
 * invalidating — the same call `useRecalculateIntent` makes, for the same
 * reason: invalidating would flash the card back through its loading state
 * immediately after the user watched it finish. It is also what keeps AC-55
 * honest — a FAILED rebuild writes nothing, so the previous brief stays on
 * screen instead of being cleared by a refetch.
 */
export function useRebuildBrief(prId: PrId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrBriefView>(`/pulls/${prId}/brief`),
    onSuccess: (data) => qc.setQueryData(keys.brief(prId), data),
  });
}

/**
 * "Something happened that may have changed this PR's brief."
 *
 * The named invalidator is the sanctioned way another domain reaches this cache
 * (frontend-architecture §10): the key's shape stays owned here, the caller
 * states intent. Nothing calls it yet — the brief is built only from its own
 * button, and a review run does not touch it (server AC-30/AC-31 make the brief
 * independent of runs). It exists so the first cross-domain caller has
 * something to call other than the key.
 */
export function invalidatePrBrief(qc: QueryClient, prId: PrId): void {
  if (prId) qc.invalidateQueries({ queryKey: keys.brief(prId) });
}

/* hooks/conventions.ts — React Query hooks for the Conventions Extractor page. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ConventionCandidate,
  ConventionCategory,
  ConventionStatus,
  ConventionsView,
} from "@devdigest/shared";

/**
 * Query keys stay PRIVATE to this module (frontend-architecture §10). A caller
 * that must invalidate says what changed through a named hook; it never retypes
 * a key.
 */
const keys = {
  view: (repoId: string | null | undefined) => ["conventions", repoId] as const,
};

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: keys.view(repoId),
    queryFn: () => api.get<ConventionsView>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/**
 * Run an extraction. The response IS the new view, so it is written straight
 * into the cache rather than invalidated — a refetch would put the page back
 * through its loading state immediately after a scan the user just watched
 * finish.
 */
export function useExtractConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ConventionsView>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (data) => qc.setQueryData(keys.view(repoId), data),
  });
}

export interface PatchConventionInput {
  id: string;
  patch: { status?: ConventionStatus; rule?: string; category?: ConventionCategory };
}

/**
 * Accept, reject or edit one candidate.
 *
 * A STATUS change is optimistic: it is a single-field flip, and a review queue
 * where every click waits on a round-trip is a queue nobody finishes. A RULE or
 * CATEGORY edit is not — that text is what the skill will contain, so it is
 * shown as written only once it has been written.
 */
export function usePatchConvention(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: PatchConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      if (patch.status === undefined) return undefined;
      // Cancel first, or an in-flight refetch lands after us and snaps the
      // status back to what the server last said.
      await qc.cancelQueries({ queryKey: keys.view(repoId) });
      const previous = qc.getQueryData<ConventionsView>(keys.view(repoId));
      if (previous) {
        qc.setQueryData<ConventionsView>(keys.view(repoId), {
          ...previous,
          candidates: previous.candidates.map((c) =>
            c.id === id ? { ...c, status: patch.status! } : c,
          ),
        });
      }
      return { previous };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.view(repoId), ctx.previous);
    },
    onSuccess: (data) => {
      const current = qc.getQueryData<ConventionsView>(keys.view(repoId));
      if (!current) return;
      qc.setQueryData<ConventionsView>(keys.view(repoId), {
        ...current,
        candidates: current.candidates.map((c) => (c.id === data.id ? data : c)),
      });
    },
  });
}

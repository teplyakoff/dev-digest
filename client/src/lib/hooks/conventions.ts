/* hooks/conventions.ts — React Query hooks for the Conventions Extractor page. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ConventionCandidate,
  ConventionCategory,
  ConventionSkillDraft,
  ConventionStatus,
  ConventionsView,
  Skill,
} from "@devdigest/shared";

/**
 * Query keys stay PRIVATE to this module (frontend-architecture §10). A caller
 * that must invalidate says what changed through a named hook; it never retypes
 * a key.
 */
const keys = {
  view: (repoId: string | null | undefined) => ["conventions", repoId] as const,
  draft: (repoId: string | null | undefined) => ["convention-skill-draft", repoId] as const,
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

/**
 * Set the same status on many candidates — the toolbar's "Accept all".
 *
 * One optimistic write for the whole list, then the PATCHes in parallel. Firing
 * the per-candidate mutation N times instead would have N optimistic handlers
 * each snapshotting a cache the previous one just changed, so a rollback would
 * restore whichever snapshot happened to be taken last.
 */
export function useSetAllConventionStatuses(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: ConventionStatus }) => {
      await Promise.all(
        ids.map((id) => api.patch<ConventionCandidate>(`/conventions/${id}`, { status })),
      );
    },
    onMutate: async ({ ids, status }) => {
      await qc.cancelQueries({ queryKey: keys.view(repoId) });
      const previous = qc.getQueryData<ConventionsView>(keys.view(repoId));
      if (previous) {
        const target = new Set(ids);
        qc.setQueryData<ConventionsView>(keys.view(repoId), {
          ...previous,
          candidates: previous.candidates.map((c) => (target.has(c.id) ? { ...c, status } : c)),
        });
      }
      return { previous };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.view(repoId), ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.view(repoId) }),
  });
}

/**
 * The merged draft, built on the SERVER from the accepted candidates.
 *
 * `enabled` is the modal being open, and the draft is never cached across
 * openings (`gcTime: 0`): accepting one more candidate between two openings has
 * to produce a different body, and a stale draft would silently create a skill
 * missing a rule the user just accepted.
 */
export function useConventionSkillDraft(repoId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: keys.draft(repoId),
    queryFn: () => api.get<ConventionSkillDraft>(`/repos/${repoId}/conventions/skill-draft`),
    enabled: !!repoId && enabled,
    gcTime: 0,
    staleTime: 0,
  });
}

/** Persist the edited draft. The server stamps the candidates it came from. */
export function useCreateConventionSkill(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: ConventionSkillDraft) =>
      api.post<Skill>(`/repos/${repoId}/conventions/skill`, draft),
    onSuccess: () => {
      // The candidates now carry `skill_id`, and the Skills grid has a new card.
      qc.invalidateQueries({ queryKey: keys.view(repoId) });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

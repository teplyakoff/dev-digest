/* hooks/context.ts — React Query hooks for the Project Context store (L06). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AttachedDoc,
  AttachmentSet,
  ContextDoc,
  ContextDocBody,
  ContextStoreStatus,
  CreateContextDoc,
  ImportCandidates,
} from "@devdigest/shared";

/**
 * `import type`, never a value import. One runtime import from
 * `@devdigest/shared` drags `zod` and the whole contract chain into the
 * production bundle and costs ~15 kB First Load JS on EVERY route — measured,
 * not feared. `import type` is erased, so this line costs nothing. NFR-3's
 * 102 kB threshold is exactly this rule holding.
 *
 * This module is deliberately NOT re-exported from `lib/hooks/index.ts`.
 * frontend-architecture §12 forbids growing a barrel, the five `export *` lines
 * there are grandfathered rather than a pattern, and a sixth is a fresh lint
 * error. Import it directly — `@/lib/hooks/context`.
 */

/**
 * Query keys stay PRIVATE to this module (frontend-architecture §10). Anything
 * that has to invalidate one of these lists says so through a named hook below;
 * it never retypes a key, and the key is never exported.
 */
const keys = {
  docs: (repoId: string | null | undefined) => ["context-docs", repoId] as const,
  doc: (repoId: string | null | undefined, docId: string | null | undefined) =>
    ["context-doc", repoId, docId] as const,
  store: (repoId: string | null | undefined) => ["context-store", repoId] as const,
  candidates: (repoId: string | null | undefined) => ["context-candidates", repoId] as const,
  agentDocs: (agentId: string | null | undefined) => ["agent-context-docs", agentId] as const,
  skillDocs: (skillId: string | null | undefined) => ["skill-context-docs", skillId] as const,
};

// ---- reads ------------------------------------------------------------------

export function useContextDocs(repoId: string | null | undefined) {
  return useQuery({
    queryKey: keys.docs(repoId),
    queryFn: () => api.get<ContextDoc[]>(`/repos/${repoId}/context/docs`),
    enabled: !!repoId,
  });
}

export function useContextDoc(
  repoId: string | null | undefined,
  docId: string | null | undefined,
) {
  return useQuery({
    queryKey: keys.doc(repoId, docId),
    queryFn: () => api.get<ContextDocBody>(`/repos/${repoId}/context/docs/${docId}`),
    enabled: !!repoId && !!docId,
  });
}

/** The status line's numbers, owned by the server rather than re-summed here. */
export function useContextStore(repoId: string | null | undefined) {
  return useQuery({
    queryKey: keys.store(repoId),
    queryFn: () => api.get<ContextStoreStatus>(`/repos/${repoId}/context/store`),
    enabled: !!repoId,
  });
}

/**
 * The import picker's candidates, read from the clone every time it opens.
 *
 * `enabled` is the picker being open, and `staleTime: 0` is what makes each
 * opening a fresh read: the clone moves under us on every poll, so a cached list
 * would offer files that are no longer there and hide ones that are.
 *
 * `retry: false`, and that is not a preference. The two failures this endpoint
 * actually has are 409 `not_cloned` and 404 — both are ANSWERS, and retrying an
 * answer only delays showing it. With the default retry the panel sat blank
 * while the picker looked broken; the "you have not cloned this yet" message a
 * person needs is the fastest thing on the screen now.
 */
export function useContextCandidates(repoId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: keys.candidates(repoId),
    queryFn: () => api.get<ImportCandidates>(`/repos/${repoId}/context/candidates`),
    enabled: !!repoId && enabled,
    staleTime: 0,
    retry: false,
  });
}

export function useAgentContextDocs(agentId: string | null | undefined) {
  return useQuery({
    queryKey: keys.agentDocs(agentId),
    queryFn: () => api.get<AttachedDoc[]>(`/agents/${agentId}/context-docs`),
    enabled: !!agentId,
  });
}

export function useSkillContextDocs(skillId: string | null | undefined) {
  return useQuery({
    queryKey: keys.skillDocs(skillId),
    queryFn: () => api.get<AttachedDoc[]>(`/skills/${skillId}/context-docs`),
    enabled: !!skillId,
  });
}

// ---- writes -----------------------------------------------------------------

/** Re-read the clone. AC-39's "rescan" is a refetch, not a second endpoint. */
export function useRescanContext(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.get<ImportCandidates>(`/repos/${repoId}/context/candidates`),
    onSuccess: (data) => qc.setQueryData(keys.candidates(repoId), data),
  });
}

/**
 * Create a document — imported, empty, or from an uploaded file's text.
 *
 * All three arrive on one endpoint, so there is one hook rather than three. The
 * upload is read in the browser (see `readUploadedDoc` below) and POSTed as
 * text, which is why nothing here is multipart.
 */
export function useCreateContextDoc(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateContextDoc) =>
      api.post<ContextDocBody>(`/repos/${repoId}/context/docs`, input),
    onSuccess: () => invalidateStore(qc, repoId),
  });
}

export function useSaveContextDoc(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docId, body }: { docId: string; body: string }) =>
      api.put<ContextDocBody>(`/repos/${repoId}/context/docs/${docId}`, { body }),
    onSuccess: (data) => {
      // The response IS the saved document, so it goes straight into the cache
      // rather than through a refetch that would flash the editor's loading
      // state immediately after a save the user just watched succeed.
      qc.setQueryData(keys.doc(repoId, data.id), data);
      invalidateStore(qc, repoId);
    },
  });
}

export function useDeleteContextDoc(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) =>
      api.del<{ deleted: true }>(`/repos/${repoId}/context/docs/${docId}`),
    onSuccess: () => {
      invalidateStore(qc, repoId);
      // A deleted document leaves every attachment set it was in, and those
      // lists are keyed by agent and by skill rather than by repo — so the
      // repo-level invalidation above does not reach them.
      qc.invalidateQueries({ queryKey: ["agent-context-docs"] });
      qc.invalidateQueries({ queryKey: ["skill-context-docs"] });
    },
  });
}

/**
 * Replace an agent's whole attachment set.
 *
 * The caller passes every id it wants attached, including the ones already
 * there. Sending only what changed would leave the server's replace semantics
 * correct and the result wrong — the ids left out are detached by their absence.
 */
export function useSetAgentContextDocs(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docIds: string[]) =>
      api.put<AttachedDoc[]>(`/agents/${agentId}/context-docs`, {
        doc_ids: docIds,
      } satisfies AttachmentSet),
    onSuccess: (data) => {
      qc.setQueryData(keys.agentDocs(agentId), data);
      invalidateReach(qc);
    },
  });
}

/** Replace a skill's whole attachment set. Same contract as the agent hook. */
export function useSetSkillContextDocs(skillId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docIds: string[]) =>
      api.put<AttachedDoc[]>(`/skills/${skillId}/context-docs`, {
        doc_ids: docIds,
      } satisfies AttachmentSet),
    onSuccess: (data) => {
      qc.setQueryData(keys.skillDocs(skillId), data);
      invalidateReach(qc);
    },
  });
}

/**
 * Attaching changes a NUMBER ON ANOTHER LIST.
 *
 * Each document row carries how many agents would receive it, so attaching to
 * an agent or to a skill makes every visible row potentially stale — including
 * rows in another repo's store, since a skill is workspace-wide. The list is
 * refetched by prefix rather than by `keys.docs(repoId)` because these two
 * mutations know an agent id or a skill id and no repo id at all, and inventing
 * one here would be guessing which store the caller is looking at.
 *
 * Without this the count is right in the database and wrong on screen until a
 * reload — which is exactly how it behaved when the count first landed.
 */
function invalidateReach(qc: ReturnType<typeof useQueryClient>): void {
  qc.invalidateQueries({ queryKey: ["context-docs"] });
}

/**
 * The named invalidator for everything keyed on a repo's store.
 *
 * Private on purpose: §10 says cross-domain invalidation goes through a named
 * hook, not through a re-exported key, and every mutation above calls this one
 * rather than listing three keys itself and forgetting the third.
 */
function invalidateStore(
  qc: ReturnType<typeof useQueryClient>,
  repoId: string | null | undefined,
): void {
  qc.invalidateQueries({ queryKey: keys.docs(repoId) });
  qc.invalidateQueries({ queryKey: keys.store(repoId) });
}

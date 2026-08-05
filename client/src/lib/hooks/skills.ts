/* hooks/skills.ts — React Query hooks for the A1 Skills page, the skill editor
   and the agent editor's Skills tab. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AgentSkillLink,
  Skill,
  SkillImportPreview,
  SkillType,
  SkillUsage,
  SkillVersion,
} from "@devdigest/shared";

/**
 * Query keys stay PRIVATE to this module (frontend-architecture §10) — the
 * pattern `hooks/reviews.ts` moved to. A caller that must invalidate says what
 * changed via a named invalidator; it never retypes a key.
 */
const keys = {
  all: ["skills"] as const,
  one: (id: string | null | undefined) => ["skill", id] as const,
  versions: (id: string | null | undefined) => ["skill-versions", id] as const,
  usage: (id: string | null | undefined) => ["skill-usage", id] as const,
  agentSkills: (agentId: string | null | undefined) => ["agent-skills", agentId] as const,
};

export function useSkills() {
  return useQuery({
    queryKey: keys.all,
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: keys.one(id),
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

/** Body history, newest version first. */
export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: keys.versions(id),
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

/** Which agents load this skill — the card's count and the delete warning. */
export function useSkillUsage(id: string | null | undefined) {
  return useQuery({
    queryKey: keys.usage(id),
    queryFn: () => api.get<SkillUsage[]>(`/skills/${id}/agents`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  enabled?: boolean;
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">>;
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.setQueryData(keys.one(data.id), data);
      // A body edit snapshots a new version; anything else leaves the list alone.
      qc.invalidateQueries({ queryKey: keys.versions(data.id) });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.removeQueries({ queryKey: keys.one(id) });
      // Deleting a skill unlinks it from every agent, so any cached agent
      // link-set is now wrong.
      qc.invalidateQueries({ queryKey: ["agent-skills"] });
    },
  });
}

// ---- import (preview → confirm) -------------------------------------------

export interface ImportUpload {
  filename: string;
  content_base64: string;
}

/**
 * Parse an upload WITHOUT writing anything. Deliberately not a query: it has no
 * cacheable identity, and re-running it on a cache miss would re-parse a file
 * the user has already moved past.
 */
export function useImportPreview() {
  return useMutation({
    mutationFn: (upload: ImportUpload) =>
      api.post<SkillImportPreview>("/skills/import/preview", upload),
  });
}

/** Write the previewed skill. It lands disabled — see the import spec. */
export function useImportConfirm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preview: SkillImportPreview) =>
      api.post<Skill>("/skills/import/confirm", preview),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

// ---- the agent side of the link (owned by the agents module) --------------

export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: keys.agentSkills(agentId),
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

/**
 * Set the agent's whole ordered skill set. Linking, unlinking and reordering all
 * resolve to this one call — the endpoint replaces the set, so there is no
 * partial state to reconcile and no per-row race.
 */
export function useSetAgentSkills(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillIds: string[]) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onMutate: async (skillIds) => {
      // Optimistic: dragging a row must feel immediate. Cancel first, or an
      // in-flight refetch lands after us and snaps the order back.
      await qc.cancelQueries({ queryKey: keys.agentSkills(agentId) });
      const previous = qc.getQueryData<AgentSkillLink[]>(keys.agentSkills(agentId));
      qc.setQueryData<AgentSkillLink[]>(
        keys.agentSkills(agentId),
        skillIds.map((skill_id, order) => ({ agent_id: agentId ?? "", skill_id, order })),
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.agentSkills(agentId), ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: keys.agentSkills(agentId) });
      // The per-skill "used by N agents" count just changed.
      qc.invalidateQueries({ queryKey: ["skill-usage"] });
    },
  });
}

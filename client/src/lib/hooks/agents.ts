/* hooks/agents.ts — React Query hooks for the A2 Agents tab + Agent Editor. */
"use client";

import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Agent, ModelInfo, Provider, ReviewStrategy } from "@devdigest/shared";

/**
 * Query keys stay PRIVATE to this module (frontend-architecture §10), the same
 * shape `hooks/skills.ts` and `hooks/reviews.ts` use. A caller in another domain
 * never retypes one — it calls the invalidator below.
 */
const keys = {
  all: ["agents"] as const,
  one: (id: string | null | undefined) => ["agent", id] as const,
  providerModels: (provider: Provider | null | undefined) =>
    ["provider-models", provider] as const,
};

/**
 * §10's sanctioned escape hatch for cross-domain invalidation: the domain that
 * OWNS the key exports the intent, so the caller never depends on the key's
 * shape. Linking, unlinking or deleting a skill changes every agent's
 * `skills_count`, which `GET /agents` denormalizes onto the card — so
 * `hooks/skills.ts` calls this instead of writing `["agents"]` itself.
 */
export function invalidateAgents(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: keys.all });
}

export function useAgents() {
  return useQuery({
    queryKey: keys.all,
    queryFn: () => api.get<Agent[]>("/agents"),
  });
}

export function useAgent(id: string | null | undefined) {
  return useQuery({
    queryKey: keys.one(id),
    queryFn: () => api.get<Agent>(`/agents/${id}`),
    enabled: !!id,
  });
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  enabled?: boolean;
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentInput) => api.post<Agent>("/agents", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

export interface UpdateAgentInput {
  id: string;
  patch: Partial<
    Pick<
      Agent,
      | "name"
      | "description"
      | "provider"
      | "model"
      | "system_prompt"
      | "output_schema"
      | "strategy"
      | "ci_fail_on"
      | "repo_intel"
      | "enabled"
    >
  >;
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateAgentInput) => api.put<Agent>(`/agents/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.setQueryData(keys.one(data.id), data);
    },
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/agents/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: keys.all });
      qc.removeQueries({ queryKey: keys.one(id) });
    },
  });
}

/** Dynamic model list for a provider (editor model picker). */
export function useProviderModels(provider: Provider | null | undefined) {
  return useQuery({
    queryKey: keys.providerModels(provider),
    queryFn: () => api.get<ModelInfo[]>(`/providers/${provider}/models`),
    enabled: !!provider,
    staleTime: 5 * 60_000,
  });
}

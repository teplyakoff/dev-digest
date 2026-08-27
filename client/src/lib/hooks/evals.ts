/* hooks/evals.ts — React Query hooks for the L06 eval pipeline (SPEC-08).

   Its own domain file rather than a corner of `agents.ts`, mirroring the
   server, where evals are `modules/evals/` and not part of `modules/agents`.

   DELIBERATELY NOT re-exported from `hooks/index.ts`. The barrel's five
   `export *` lines are baselined in `eslint-suppressions.json`; a sixth is a
   fresh `no-restricted-syntax` error and `pnpm lint` fails
   (frontend-architecture §12, `client/INSIGHTS.md`). Consumers import
   `@/lib/hooks/evals` directly.

   Contract types are imported as TYPES ONLY. Importing a Zod schema as a value
   measured at ~15 kB First Load JS on every route, because nothing else in this
   package bundles `zod` (`client/INSIGHTS.md`, NFR-11). */
"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api } from "../api";
import type {
  CreateEvalCaseFromFinding,
  EvalBatchCompare,
  EvalBatchRecord,
  EvalCaseRecord,
  EvalCaseUpsertBody,
  EvalDashboard,
  EvalRunRecord,
} from "@devdigest/shared";

type Id = string | null | undefined;

/**
 * Query keys stay PRIVATE to this module (frontend-architecture §10), the same
 * shape `hooks/agents.ts`, `hooks/reviews.ts` and `hooks/intent.ts` use. A
 * caller in another domain never retypes one — it calls `invalidateEvals`.
 */
const keys = {
  cases: (agentId: Id) => ["eval-cases", agentId] as const,
  dashboard: (agentId: Id) => ["eval-dashboard", agentId] as const,
  batches: (agentId: Id) => ["eval-batches", agentId] as const,
  batch: (batchId: Id) => ["eval-batch", batchId] as const,
  batchRuns: (batchId: Id) => ["eval-batch-runs", batchId] as const,
  compare: (a: Id, b: Id) => ["eval-batch-compare", a, b] as const,
};

/**
 * How often a running batch is re-polled, in ms. Matches the cadence
 * `hooks/reviews.ts` already uses for in-flight runs, so a page showing both
 * does not have two competing rhythms.
 */
const RUNNING_POLL_MS = 4000;

/**
 * §10's sanctioned escape hatch for cross-domain invalidation: the domain that
 * OWNS the key exports the intent, so the caller never depends on the key's
 * shape.
 *
 * "This agent's eval set changed" — a case was created, edited or deleted. Both
 * the case list and the dashboard move, because `cases_total` is denormalized
 * onto the dashboard payload.
 *
 * NOTE for callers in the `reviews` domain: creating a case from a finding does
 * NOT change anything the `reviews` query returns, so it deliberately does not
 * invalidate it — a refetch would flash the findings panel through its loading
 * state to receive a byte-identical payload. The finding card learns that a
 * case now exists from the mutation's own response
 * (`CreateEvalCaseFromFinding.case` + `.existing_cases`), which is the only
 * place that fact is served from.
 */
export function invalidateEvals(qc: QueryClient, agentId: Id): void {
  if (!agentId) return;
  void qc.invalidateQueries({ queryKey: keys.cases(agentId) });
  void qc.invalidateQueries({ queryKey: keys.dashboard(agentId) });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The agent's whole eval set, in ONE request regardless of set size (NFR-14).
 * There is no pagination and no per-case follow-up fetch; a 100-case set is one
 * `GET`, and adding a second request here is what that criterion forbids.
 */
export function useEvalCases(agentId: Id) {
  return useQuery({
    queryKey: keys.cases(agentId),
    queryFn: () => api.get<EvalCaseRecord[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

/**
 * The agent's eval dashboard.
 *
 * Returned WHOLE and unmapped, because the payload carries two channels that
 * must not be collapsed into one:
 *
 *   - `current` — the latest FINISHED batch. The last-good-numbers channel:
 *     while a new batch runs, this still shows the previous batch's real
 *     numbers instead of replacing a real score with three dashes.
 *   - `latest_batch` — the newest batch of ANY status, `running` included. The
 *     lifecycle channel: it is what lets a tab that never received the 202 (a
 *     reload, or a second browser tab) know a batch is in flight and keep the
 *     run action disabled (AC-80). Without it the 409 on a concurrent batch
 *     becomes reachable through ordinary use rather than only a race.
 *
 * While a batch runs the two point at different rows; the rest of the time they
 * agree. Read `latest_batch.status` for lifecycle and `current` for numbers.
 *
 * Every metric on this payload is `number | null`, and `null` means UNKNOWN.
 * This module never coerces one to `0` — that coercion is the single defect
 * SPEC-08 is organised against, and it belongs to no layer, least of all this
 * one.
 */
export function useEvalDashboard(agentId: Id) {
  return useQuery({
    queryKey: keys.dashboard(agentId),
    queryFn: () => api.get<EvalDashboard>(`/agents/${agentId}/eval-dashboard`),
    enabled: !!agentId,
    // Poll only while the LIFECYCLE channel says a batch is in flight, so a tab
    // that did not start the run still sees it finish.
    refetchInterval: (query) =>
      query.state.data?.latest_batch?.status === "running" ? RUNNING_POLL_MS : false,
  });
}

/**
 * The agent's batch history — every batch, NEWEST FIRST, in ONE request
 * (NFR-14: no cursor, no page param; the server caps it at 50).
 *
 * This is the list the compare flow selects its two runs from, and it is a
 * separate read from `useEvalDashboard` on purpose: the dashboard's payload
 * carries `recent_runs` (per-CASE rows, which have no batch id) and `trend`
 * (per-batch points, which have no id at all), while comparison is a
 * batch-level operation keyed by two batch ids.
 *
 * ORDER IS LOAD-BEARING. The server sorts `started_at DESC, id DESC`, and
 * `EvalRunsTable` pairs its two selected rows as `(older, newer)` off that
 * order — `started_at` defaults to transaction time, so two batches genuinely
 * can share one, and the list's own order is what breaks the tie. Re-sorting
 * this array in a consumer would flip the sign of every delta on a tie and
 * render an improvement as a regression.
 *
 * `running` batches are included: a batch in flight is part of the history, not
 * a thing that appears once it finishes.
 */
export function useEvalBatches(agentId: Id) {
  return useQuery({
    queryKey: keys.batches(agentId),
    queryFn: () => api.get<EvalBatchRecord[]>(`/agents/${agentId}/eval-batches`),
    enabled: !!agentId,
    // Same rhythm and the same rule as `useEvalDashboard`: poll only while this
    // list itself says a batch is in flight, so the row that started as
    // `running` fills in its aggregates without a manual reload.
    refetchInterval: (query) =>
      query.state.data?.some((b) => b.status === "running") ? RUNNING_POLL_MS : false,
  });
}

/** One batch row, polled while it is still running. */
export function useEvalBatch(batchId: Id) {
  return useQuery({
    queryKey: keys.batch(batchId),
    queryFn: () => api.get<EvalBatchRecord>(`/eval-batches/${batchId}`),
    enabled: !!batchId,
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? RUNNING_POLL_MS : false,
  });
}

/** Every case run inside one batch (one row per case). */
export function useEvalBatchRuns(batchId: Id) {
  return useQuery({
    queryKey: keys.batchRuns(batchId),
    queryFn: () => api.get<EvalRunRecord[]>(`/eval-batches/${batchId}/runs`),
    enabled: !!batchId,
  });
}

/**
 * Two batches side by side. `comparable` and `prompt_diff_available` are the
 * SERVER's decisions (NFR-6) — the client displays them and does not recompute
 * them.
 */
export function useEvalCompare(a: Id, b: Id) {
  return useQuery({
    queryKey: keys.compare(a, b),
    queryFn: () =>
      api.get<EvalBatchCompare>(
        `/eval-batches/compare?${new URLSearchParams({ a: String(a), b: String(b) })}`,
      ),
    enabled: !!a && !!b,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * One click, one request, no modal (AC-65): turn a decided finding into an eval
 * case. The expectation direction is derived server-side from the finding's own
 * decision — accepted → `must_find`, dismissed → `must_not_flag`.
 *
 * The response also carries `existing_cases`, the cases already seeded from the
 * same finding. Creating a second one is allowed; the caller is told about the
 * others rather than blocked (AC-68).
 *
 * A 422 body carries the reason — e.g. the finding's file has no stored patch
 * text — and the caller surfaces THAT string, not a generic one (AC-67).
 */
export function useCreateEvalCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (findingId: string) =>
      api.post<CreateEvalCaseFromFinding>(`/findings/${findingId}/eval-case`),
    // The owning agent comes back on the created row, so the caller does not
    // have to know it. `reviews` is deliberately untouched — see
    // `invalidateEvals`.
    onSuccess: (data) => invalidateEvals(qc, data.case.owner_id),
  });
}

export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EvalCaseUpsertBody) => api.post<EvalCaseRecord>("/eval-cases", body),
    onSuccess: (created) => invalidateEvals(qc, created.owner_id),
  });
}

export interface UpdateEvalCaseInput {
  id: string;
  body: EvalCaseUpsertBody;
}

export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: UpdateEvalCaseInput) =>
      api.put<EvalCaseRecord>(`/eval-cases/${id}`, body),
    onSuccess: (updated) => invalidateEvals(qc, updated.owner_id),
  });
}

export interface DeleteEvalCaseInput {
  id: string;
  /** The owning agent — the delete response carries only the deleted id. */
  agentId: string;
}

export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DeleteEvalCaseInput) =>
      api.del<{ deleted: string }>(`/eval-cases/${id}`),
    onSuccess: (_data, { agentId }) => invalidateEvals(qc, agentId),
  });
}

/**
 * Start a batch: every case of this agent, run once, against a snapshot of the
 * exact prompt/version/provider/model that produced it.
 *
 * The route answers **202** with a batch row already in `running` — the work
 * continues server-side. Seeding that row into its own cache entry starts the
 * poll immediately, and invalidating the dashboard makes `latest_batch` report
 * `running` at once, so the run action disables without waiting for the next
 * scheduled refetch (AC-80).
 *
 * Rate-limited to 3/min server-side; a concurrent batch answers 409 and an
 * empty set answers 422, both with a reason the caller surfaces.
 */
export function useRunEvalBatch(agentId: Id) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalBatchRecord>(`/agents/${agentId}/eval-batches`),
    onSuccess: (batch) => {
      qc.setQueryData(keys.batch(batch.id), batch);
      void qc.invalidateQueries({ queryKey: keys.dashboard(agentId) });
      // The history gains a row the moment the 202 lands, which is also what
      // starts that list's own `running` poll. Written against the
      // module-private key rather than through `invalidateEvals`: this is the
      // same domain, so it needs no cross-domain surface, and `invalidateEvals`
      // means "this agent's CASE SET changed" — a case edit does not move the
      // batch history, and widening it would refetch 50 rows on every keystroke
      // in the case editor.
      void qc.invalidateQueries({ queryKey: keys.batches(agentId) });
    },
  });
}

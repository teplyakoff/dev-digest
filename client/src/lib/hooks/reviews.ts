/* hooks/reviews.ts — React Query + SSE hooks for the A2 reviewer.
   Run a review, stream RunEvents live, act on findings. */
"use client";

import React from "react";
import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, API_BASE } from "../api";
import { notify } from "../toast";
import type {
  FindingActionKind,
  PrIntentView,
  PrReviewComment,
  ReviewRecord,
  ReviewRunResponse,
  RunEvent,
  RunSummary,
  SmartDiff,
} from "@devdigest/shared";

/**
 * Query keys stay PRIVATE to this module (frontend-architecture §10).
 *
 * They used to leak: the PR detail page held its own `useQueryClient` and
 * retyped `["pr-active-runs", prId]` and `["pr-runs", prId]` by hand. That is
 * the coupling the rule exists to prevent — this file could no longer change
 * how a run is cached without a page it has never heard of going stale.
 *
 * The sanctioned escape hatch for a caller that genuinely must invalidate is a
 * NAMED INVALIDATOR exported below. The caller states intent ("runs changed");
 * this module keeps ownership of the shape.
 */
type PrId = string | null | undefined;

const keys = {
  activeRuns: (prId: PrId) => ["pr-active-runs", prId] as const,
  runs: (prId: PrId) => ["pr-runs", prId] as const,
  reviews: (prId: PrId) => ["reviews", prId] as const,
  comments: (prId: PrId) => ["pr-comments", prId] as const,
  intent: (prId: PrId) => ["pr-intent", prId] as const,
  smartDiff: (prId: PrId) => ["pr-smart-diff", prId] as const,
};

/**
 * "The set of in-flight runs for this PR may have changed" — e.g. runs were just
 * started from the header dropdown.
 */
export function invalidateActiveRuns(qc: QueryClient, prId: PrId): void {
  if (prId) qc.invalidateQueries({ queryKey: keys.activeRuns(prId) });
}

/**
 * "A run settled" — refresh the history so a just-failed or just-finished run
 * appears immediately, with no page reload.
 */
export function invalidateRunHistory(qc: QueryClient, prId: PrId): void {
  if (prId) qc.invalidateQueries({ queryKey: keys.runs(prId) });
}

/**
 * The React-facing form of the invalidators above, for components that need
 * them outside a mutation callback. Keeps `useQueryClient` — and with it any
 * knowledge of cache shape — inside this module.
 *
 * `intent` is here, and not only in `useDeriveIntent`, because the review path
 * derives intent as SHARED PRE-WORK (`run-executor.ts`, before the agent loop).
 * So the first review on a PR that had no intent produces one that this page
 * never asked for — and without this invalidation the card keeps rendering its
 * empty state until a manual reload. An exported invalidator with no caller
 * reads as done while doing nothing, which is the failure `client/INSIGHTS.md`
 * (2026-08-05) describes: a stale value that looks right until you reload, and
 * that a demo surfaces where a test does not.
 */
export function useInvalidatePrRuns(prId: PrId) {
  const qc = useQueryClient();
  return React.useMemo(
    () => ({
      /** Runs were just started. */
      active: () => invalidateActiveRuns(qc, prId),
      /** A run reached a terminal status. */
      history: () => invalidateRunHistory(qc, prId),
      /** A run settled, so it may have derived or re-derived the intent. */
      intent: () => invalidatePrIntent(qc, prId),
      /** A run settled, so the Smart Diff's findings/badges are now stale. */
      smartDiff: () => invalidateSmartDiff(qc, prId),
    }),
    [qc, prId],
  );
}

// ---- Active (in-flight) runs — server-side source of truth ----
export interface ActiveRun {
  run_id: string;
  agent_id: string | null;
  agent_name: string | null;
  ran_at: string | null;
}

/** In-flight runs for a PR, from the server (agent_runs where status='running').
   Survives reloads/devices; polls while anything is running so it self-clears. */
export function usePrActiveRuns(prId: PrId) {
  return useQuery({
    queryKey: keys.activeRuns(prId),
    queryFn: () => api.get<ActiveRun[]>(`/pulls/${prId}/runs/active`),
    enabled: !!prId,
    refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? 4000 : false),
  });
}

// ---- Full run history for a PR (every agent_runs row, any status) ----
/** All runs for a PR — done, failed (with error), cancelled, running. Survives
   reload (DB-backed). Polls while anything is running so it self-updates. */
export function usePrRuns(prId: PrId) {
  return useQuery({
    queryKey: keys.runs(prId),
    queryFn: () => api.get<RunSummary[]>(`/pulls/${prId}/runs`),
    enabled: !!prId,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((r) => r.status === "running") ? 4000 : false,
  });
}

// ---- Persisted reviews + findings for a PR ----
export function usePrReviews(prId: PrId) {
  return useQuery({
    queryKey: keys.reviews(prId),
    queryFn: () => api.get<ReviewRecord[]>(`/pulls/${prId}/reviews`),
    enabled: !!prId,
  });
}

// ---- Derived PR intent (L03) ----
/**
 * The PR's derived intent. `{intent: null}` before the first derivation — a 200
 * with a null, never a 404, so the card renders its empty state without the
 * caller having to read a status code.
 */
export function usePrIntent(prId: PrId) {
  return useQuery({
    queryKey: keys.intent(prId),
    queryFn: () => api.get<PrIntentView>(`/pulls/${prId}/intent`),
    enabled: !!prId,
  });
}

/**
 * Derive (or re-derive) the intent now.
 *
 * The response IS the new view, so it goes straight into the cache rather than
 * invalidating — the same call `useExtractConventions` makes, for the same
 * reason: invalidating would flash the card back through its loading state
 * immediately after the user watched it finish.
 */
export function useDeriveIntent(prId: PrId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrIntentView>(`/pulls/${prId}/intent`),
    onSuccess: (data) => qc.setQueryData(keys.intent(prId), data),
  });
}

/**
 * "A review run finished, so the intent may have been (re-)derived by it" — the
 * named invalidator, because the review path derives intent as shared pre-work
 * and the card must not keep showing the pre-run state.
 */
export function invalidatePrIntent(qc: QueryClient, prId: PrId): void {
  if (prId) qc.invalidateQueries({ queryKey: keys.intent(prId) });
}

// ---- Smart Diff (L03) ----
/**
 * The PR's files grouped by role (core / wiring / boilerplate), with each file's
 * findings joined on. Computed on read from data the server already has — no
 * model call — so it is safe to fetch as soon as the Files tab mounts.
 *
 * No schema is passed to `api.get`: no call site in this codebase validates at
 * runtime, deliberately. Importing a Zod schema here would drag the whole
 * `@devdigest/shared` barrel plus `zod` into the shared chunk (~15 kB First Load
 * JS on every route, measured — `client/INSIGHTS.md` 2026-08-03), which is why
 * `SmartDiff` above is a TYPE-only import.
 */
export function useSmartDiff(prId: PrId) {
  return useQuery({
    queryKey: keys.smartDiff(prId),
    queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
  });
}

/**
 * "A review run finished, so this PR's findings changed" — Smart Diff joins
 * EVERY stored review's findings onto the file list (one review row is one
 * agent), so a settled run invalidates it even though nothing about the files
 * themselves moved. Without this the badges
 * and line rails keep showing the pre-run state until a manual reload: a stale
 * number that looks right, which a demo surfaces and a test does not
 * (`client/INSIGHTS.md` 2026-08-05).
 */
export function invalidateSmartDiff(qc: QueryClient, prId: PrId): void {
  if (prId) qc.invalidateQueries({ queryKey: keys.smartDiff(prId) });
}

/** Delete one run from the PR's run history (+ its trace). */
export function useDeleteRun(prId: PrId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.del<{ ok: boolean }>(`/runs/${runId}`),
    // Deleting a run also deletes the review it produced (server-side), so drop
    // both the timeline and the Review Runs list from cache.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.runs(prId) });
      qc.invalidateQueries({ queryKey: keys.reviews(prId) });
    },
  });
}

/** Request cancellation of an in-flight run (takes effect at the next step). */
export function useCancelRun() {
  return useMutation({
    mutationFn: (runId: string) => api.post<{ ok: boolean }>(`/runs/${runId}/cancel`),
  });
}

/** Delete a whole review run (one agent's pass) + its findings. */
export function useDeleteReview(prId: PrId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reviewId: string) => api.del<{ ok: boolean }>(`/reviews/${reviewId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.reviews(prId) }),
  });
}

// ---- Inline review comments on the "Files changed" tab (proxied to GitHub) --
/** Existing GitHub PR review comments, fetched live. */
export function usePrComments(prId: PrId) {
  return useQuery({
    queryKey: keys.comments(prId),
    queryFn: () => api.get<PrReviewComment[]>(`/pulls/${prId}/comments`),
    enabled: !!prId,
  });
}

export interface CreateCommentInput {
  path: string;
  line: number;
  side?: "LEFT" | "RIGHT";
  body: string;
  in_reply_to?: number;
}

/** Post one inline comment (or reply) to GitHub; refreshes the thread list. */
export function useCreatePrComment(prId: PrId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCommentInput) =>
      api.post<PrReviewComment>(`/pulls/${prId}/comments`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.comments(prId) }),
  });
}

// ---- Run a review (all enabled agents or a specific agent) ----
export interface RunReviewInput {
  prId: string;
  agentId?: string;
  all?: boolean;
}

export function useRunReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentId, all }: RunReviewInput) =>
      api.post<ReviewRunResponse>(`/pulls/${prId}/review`, {
        ...(agentId ? { agentId } : {}),
        ...(all ? { all } : {}),
      }),
    onSuccess: (_d, { prId }) => {
      qc.invalidateQueries({ queryKey: keys.reviews(prId) });
    },
  });
}

// ---- Finding actions (accept/dismiss) ----
export function useFindingAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      findingId,
      action,
      reply,
      prId: _prId,
    }: {
      findingId: string;
      action: FindingActionKind;
      reply?: string;
      prId?: string;
    }) =>
      api.post<{ finding: ReviewRecord["findings"][number]; memoryId?: string }>(
        `/findings/${findingId}/${action}`,
        reply ? { reply } : undefined,
      ),
    onSuccess: (_d, { prId }) => {
      if (prId) qc.invalidateQueries({ queryKey: keys.reviews(prId) });
    },
  });
}

/**
 * Subscribe to a run's SSE event stream. Returns the accumulated RunEvents and a
 * `running` flag (true until the stream closes). Live status for the
 * RunReviewDropdown / Live Log. Multiple runIds are subscribed in parallel.
 */
export function useRunEvents(runIds: string[]) {
  const [events, setEvents] = React.useState<RunEvent[]>([]);
  const [running, setRunning] = React.useState(false);
  const key = runIds.join(",");

  React.useEffect(() => {
    if (runIds.length === 0) return;
    setEvents([]);
    setRunning(true);
    const sources: EventSource[] = [];
    let open = runIds.length;

    for (const runId of runIds) {
      const es = new EventSource(`${API_BASE}/runs/${runId}/events`);
      const onMsg = (ev: MessageEvent) => {
        try {
          const parsed = JSON.parse(ev.data) as RunEvent;
          setEvents((prev) => [...prev, parsed]);
          // Runtime agent failures arrive as SSE `error` events (not as a
          // mutation/query error), so the global error toast never sees them —
          // surface them here so the user gets a notification without a reload.
          if (parsed.kind === "error" && parsed.msg) notify.error(parsed.msg);
        } catch {
          /* ignore non-JSON keepalive frames (and dataless native error events) */
        }
      };
      // The server tags events with kind as the SSE `event:` name AND emits them
      // as default messages too in some clients — listen broadly.
      es.onmessage = onMsg;
      for (const kind of ["info", "tool", "result", "error"]) {
        es.addEventListener(kind, onMsg as EventListener);
      }
      es.onerror = () => {
        es.close();
        open -= 1;
        if (open <= 0) setRunning(false);
      };
      sources.push(es);
    }

    return () => {
      for (const es of sources) es.close();
      setRunning(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { events, running };
}

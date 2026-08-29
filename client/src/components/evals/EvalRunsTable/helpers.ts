/* helpers.ts — pure logic for EvalRunsTable.

   THE RULE THIS FILE IS WRITTEN AGAINST: a metric is `number | null`, and `null`
   means UNKNOWN. There is deliberately no `?? 0` here — a batch whose recall had
   no denominator renders an em dash and keeps its row, because `0%` would read
   as a real, terrible score (AC-74). */

import type { EvalBatchRecord } from "@devdigest/shared";

/**
 * A 0…1 metric as a whole-percent string, or `null` when it is unknown.
 * `null` in, `null` out — the caller renders `dashboard.unknownValue`.
 */
export function formatPercent(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${Math.round(value * 100)}%`;
}

/**
 * A batch's start timestamp, in the same shape the rest of the app uses
 * (`ReviewRunAccordion`, `SkillVersionsTab`): `toLocaleString()` behind a NaN
 * guard, so an unparseable value falls back to the raw ISO string rather than
 * rendering "Invalid Date".
 */
export function formatRanAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Add or remove one id — selection is UI state, so it is the only thing stored. */
export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/**
 * Whether the Compare action is available, and if not, which hint explains it.
 *
 * Computed during render from the selection, never stored
 * (`react-best-practices` — Derive, Don't Store): the enabled flag and the two
 * batches it would compare are one reading of one array.
 *
 *   - `count`  — fewer or more than exactly two rows are selected (AC-87).
 *   - `agents` — two rows from DIFFERENT agents (AC-88). The server's
 *     `comparable` flag is keyed strictly on provider + model (NFR-6) and
 *     deliberately does not consider the agent, so this decision is the
 *     client's own and is made here rather than assumed of the response.
 *
 * `older` / `newer` come back ordered oldest-first, because the compare endpoint
 * reports `b − a` and a reversed pair silently flips the sign of every delta —
 * an improvement rendered as a regression, which is worse than an error because
 * it looks like a result.
 *
 * TIES ARE REAL, AND `started_at` ALONE CANNOT BREAK THEM. The column defaults
 * to `now()` — transaction time — so two batches can share a timestamp exactly,
 * and Postgres guarantees no order between them. `selected` therefore arrives in
 * THE LIST'S OWN ORDER (newest first, `started_at DESC, id DESC` from
 * `GET /agents/:id/eval-batches`), and the comparison below is strict `<`: when
 * the timestamps differ they decide, and when they tie the caller's order does.
 * That is why this function must never sort its input.
 */
export type CompareState =
  | { enabled: true; older: EvalBatchRecord; newer: EvalBatchRecord }
  | { enabled: false; reason: "count" | "agents" };

export function compareState(selected: readonly EvalBatchRecord[]): CompareState {
  const first = selected[0];
  const second = selected[1];
  if (selected.length !== 2 || !first || !second) return { enabled: false, reason: "count" };
  if (first.agent_id !== second.agent_id) return { enabled: false, reason: "agents" };
  // Strict, not `<=`: on an exact tie this falls through to the else branch and
  // the LIST's order decides, which is the server's `id DESC` tiebreaker
  // arriving intact rather than being re-derived here.
  const olderFirst = first.started_at < second.started_at;
  return {
    enabled: true,
    older: olderFirst ? first : second,
    newer: olderFirst ? second : first,
  };
}

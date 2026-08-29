/* helpers.ts — pure derivation for the Evals tab and its rows.

   Everything here is computed DURING RENDER by its callers; nothing in this
   file is ever mirrored into `useState` or synced by an Effect
   (`react-best-practices` — Derive, Don't Store). That is why the last-run
   lookup is a plain function over the fetched payload rather than a cache the
   tab maintains.

   `EvalRunStatus` is imported as a TYPE ONLY. Importing the Zod enum as a value
   drags `zod` into the shared chunk and costs ~15 kB First Load JS on every
   route (`client/INSIGHTS.md`, NFR-11). */
import type { EvalRunRecord, EvalRunStatus } from "@devdigest/shared";

/**
 * What a row shows for its case.
 *
 * `errored` is a THIRD state, not a shade of `failed` (AC-79): `failed` means
 * the agent answered and the answer was wrong, `errored` means the case never
 * produced a comparable answer at all. `never` means the case has no recorded
 * run — which is a neutral fact, not a failure (AC-78).
 */
export type EvalCaseStatus = EvalRunStatus | "never";

/**
 * The newest run per case, keyed by `case_id`.
 *
 * Built from `EvalDashboard.recent_runs`, which the server returns NEWEST FIRST
 * — so the first row seen for a case id wins and later ones are older runs of
 * the same case.
 *
 * KNOWN LIMIT, and it is the server's shape rather than a bug here:
 * `recent_runs` is capped at `RECENT_RUNS_LIMIT` (50) rows across all of the
 * agent's batches, so a case whose only run has fallen off the end of that
 * window reads as `never`. There is no per-case last-run field on
 * `EvalCaseRecord` and no second endpoint to ask for one, and adding a
 * per-case fetch would break NFR-14's "the whole set in one request".
 */
export function lastRunByCase(runs: EvalRunRecord[] | undefined): Map<string, EvalRunRecord> {
  const out = new Map<string, EvalRunRecord>();
  for (const run of runs ?? []) {
    if (!out.has(run.case_id)) out.set(run.case_id, run);
  }
  return out;
}

/**
 * The row's state, read from `eval_runs.status` (AC-113).
 *
 * The `pass` fallback is the degraded path for rows written before the status
 * column existed. It cannot recover `errored` — the contract says so: `pass`'s
 * own `null` already means "metrics empty" — so a legacy row with no verdict
 * lands on `errored`, which is the honest reading of "produced no comparable
 * answer" and never claims a pass or a fail it cannot support.
 */
export function caseStatus(run: EvalRunRecord | undefined): EvalCaseStatus {
  if (!run) return "never";
  if (run.status) return run.status;
  if (run.pass === true) return "passed";
  if (run.pass === false) return "failed";
  return "errored";
}

/**
 * How many percent to show in the ` · recall N%` suffix, or `null` for no
 * suffix at all.
 *
 * `null` in, `null` out. An unknown recall must not render as `0%` — that
 * coercion is the single defect SPEC-08 is organised against, and a row is not
 * exempt from it because it is small.
 */
export function recallPercent(run: EvalRunRecord | undefined): number | null {
  if (!run || run.recall == null || !Number.isFinite(run.recall)) return null;
  return Math.round(run.recall * 100);
}

/**
 * Is a batch for this agent in flight?
 *
 * Reads the LIFECYCLE channel (`latest_batch`), never the numbers channel
 * (`current`) — that is the whole point of the two being separate. A tab that
 * never received the 202 (a reload, or a second browser tab) learns a run is in
 * progress only from here, and AC-80 is exactly that case.
 */
export function isBatchRunning(status: string | null | undefined): boolean {
  return status === "running";
}

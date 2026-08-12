import type { Agent, FindingRecord, RunSummary, Severity } from '@devdigest/shared';
import type { ApiClient } from '../api/types.js';
import { pollUntil } from '../poll.js';
import { ResolveError, type Resolver } from '../resolve.js';

/**
 * Ring 2 — the blocking review. Six dependent steps and a loop: resolve the PR,
 * resolve the agent, POST, poll, read the reviews back, summarise. onion §9 says
 * that body is a service, and it is.
 *
 * It reports progress and observes cancellation through CALLBACKS, so nothing
 * about MCP, notifications or the SDK reaches in here (§5, "invert instead of
 * importing"). The tool layer supplies them; a test supplies nothing.
 */

/** `trace.ts:132`; written in `run-executor.ts:166, 502, 593-602`. */
export const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled']);

export interface RunReviewCommand {
  pullRequest: string;
  /** Agent name or id. Ignored when `allAgents` is true. */
  agent?: string | undefined;
  allAgents: boolean;
  maxWaitSeconds: number;
  topFindings: number;
}

/**
 * `completed` means the REVIEW succeeded, not that the poll stopped.
 *
 * The distinction is not academic and it was not free: a run that hits the
 * API's own 10-minute executor deadline settles as `failed`, which is a
 * terminal status, so the poll ends normally. Reporting that as `completed`
 * with `findings_total: 0` tells the caller the pull request is clean when in
 * fact nothing reviewed it. Observed live on a real PR — run 63f42ba1,
 * "Run exceeded the 10-minute deadline and was aborted", reported as completed.
 *
 * `partial` exists for `all_agents`, where one agent finishing and another
 * failing is ordinary. Collapsing that into either neighbour loses something a
 * caller acts on.
 */
export type RunReviewStatus =
  /** Every run reached `done`. */
  | 'completed'
  /** At least one run reached `done`, at least one did not. */
  | 'partial'
  /** The poll settled and NO run reached `done` — all failed or were cancelled. */
  | 'failed'
  /** `max_wait_seconds` elapsed; the runs are still going. */
  | 'timeout'
  /** The caller aborted the tool call; the runs are still going. */
  | 'cancelled';

export interface RunReviewOutcome {
  status: RunReviewStatus;
  label: string;
  pullId: string;
  runIds: string[];
  runs: RunSummary[];
  topFindings: FindingRecord[];
  totalFindings: number;
  severityCounts: Record<Severity, number>;
  waitedMs: number;
}

export interface RunReviewPorts {
  api: ApiClient;
  resolver: Resolver;
  signal: AbortSignal;
  /** Called on every non-terminal poll. Progress notifications hang off this. */
  onProgress?: (info: { tick: number; elapsedMs: number; pending: number; total: number }) => Promise<void> | void;
}

export async function runReview(
  cmd: RunReviewCommand,
  ports: RunReviewPorts,
): Promise<RunReviewOutcome> {
  const { api, resolver, signal } = ports;
  const { pullId, repo, pull } = await resolver.pull(cmd.pullRequest, signal);
  const label = repo && pull ? `${repo.full_name}#${pull.number}` : cmd.pullRequest;

  const body = cmd.allAgents
    ? { all: true }
    : { agentId: (await resolveAgent(cmd.agent, api, signal)).id };

  // `reviews` on this response is ALWAYS `[]` — the server fires the runs and
  // returns (`modules/reviews/service.ts:132-137`). Only `runs` is real.
  const started = await api.startReview(pullId, body, signal);
  const runIds = started.runs.map((r) => r.run_id);
  if (runIds.length === 0) {
    throw new ResolveError(
      `${label}: the API accepted the request but started no runs. Check that at least one agent is enabled (list_agents).`,
    );
  }

  const wanted = new Set(runIds);
  const outcome = await pollUntil<RunSummary[]>({
    // `GET /pulls/:id/runs` returns EVERY run this PR ever had. Without this
    // filter the loop settles on an OLD `done` run and reports its findings as
    // if they were the new ones.
    fetch: async (s) => (await api.listRuns(pullId, s)).filter((r) => wanted.has(r.run_id)),
    done: (runs) =>
      runs.length === wanted.size && runs.every((r) => TERMINAL_STATUSES.has(r.status ?? '')),
    maxWaitMs: cmd.maxWaitSeconds * 1_000,
    signal,
    onTick: async ({ tick, elapsedMs, value }) => {
      const settled = value.filter((r) => TERMINAL_STATUSES.has(r.status ?? '')).length;
      await ports.onProgress?.({
        tick,
        elapsedMs,
        pending: wanted.size - settled,
        total: wanted.size,
      });
    },
  });

  const runs = outcome.value ?? [];
  // `settled` is a statement about the POLL, not about the review. Ask the runs
  // themselves what happened before naming the outcome.
  const succeeded = runs.filter((r) => r.status === 'done').length;
  const status: RunReviewStatus =
    outcome.status === 'aborted'
      ? 'cancelled'
      : outcome.status === 'timeout'
        ? 'timeout'
        : succeeded === 0
          ? 'failed'
          : succeeded === runs.length
            ? 'completed'
            : 'partial';

  // Findings are only worth reading back when something actually finished.
  let topFindings: FindingRecord[] = [];
  let totalFindings = 0;
  const severityCounts: Record<Severity, number> = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };

  if (succeeded > 0 && (status === 'completed' || status === 'partial')) {
    const reviews = await api.listReviews(pullId, signal);
    // One row per AGENT — union them, never `.find()` (server/INSIGHTS.md:343-356).
    const fresh = reviews
      .filter((r) => r.kind === 'review' && r.run_id !== null && wanted.has(r.run_id))
      .flatMap((r) => r.findings);
    totalFindings = fresh.length;
    for (const f of fresh) severityCounts[f.severity] += 1;
    topFindings = [...fresh].sort(bySeverity).slice(0, cmd.topFindings);
  }

  return {
    status,
    label,
    pullId,
    runIds,
    runs,
    topFindings,
    totalFindings,
    severityCounts,
    waitedMs: outcome.elapsedMs,
  };
}

const SEVERITY_ORDER: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

function bySeverity(a: FindingRecord, b: FindingRecord): number {
  const bySev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  return bySev !== 0 ? bySev : b.confidence - a.confidence;
}

async function resolveAgent(
  ref: string | undefined,
  api: ApiClient,
  signal: AbortSignal,
): Promise<Agent> {
  const agents = await api.listAgents(signal);
  const enabled = agents.filter((a) => a.enabled);

  if (!ref) {
    if (enabled.length === 1 && enabled[0]) return enabled[0];
    throw new ResolveError(
      enabled.length === 0
        ? 'No enabled review agents exist in this workspace, so there is nothing to run.'
        : `Name the agent to run, or pass all_agents: true. Enabled agents: ${enabled
            .map((a) => a.name)
            .join(', ')}.`,
    );
  }

  const byId = agents.find((a) => a.id === ref);
  if (byId) return assertEnabled(byId);

  const byName = agents.filter((a) => a.name.toLowerCase() === ref.toLowerCase());
  if (byName.length > 1) {
    throw new ResolveError(
      `"${ref}" matches ${byName.length} agents. Pass an id instead: ${byName.map((a) => a.id).join(', ')}.`,
    );
  }
  if (byName[0]) return assertEnabled(byName[0]);

  throw new ResolveError(
    `No agent "${ref}". Agents in this workspace: ${
      agents.length > 0
        ? agents.map((a) => `${a.name}${a.enabled ? '' : ' (disabled)'}`).join(', ')
        : 'none — create one in the DevDigest UI'
    }.`,
  );
}

function assertEnabled(agent: Agent): Agent {
  if (!agent.enabled) {
    throw new ResolveError(
      `Agent "${agent.name}" is disabled, so it cannot run. Enable it in the DevDigest UI, or pick another (list_agents).`,
    );
  }
  return agent;
}

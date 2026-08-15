import { z } from 'zod';
import type { ToolResult } from '../api/types.js';
import type { Deps } from '../deps.js';
import { applyCharacterLimit, clamp, lineRef, textResult, untrusted } from '../format.js';
import { runReview, type RunReviewOutcome } from '../usecases/run-review.js';
import { failure, type ToolDescriptor, type ToolExtra } from './types.js';

/** The ceiling is the run this repo has actually observed: 945 s (`server/INSIGHTS.md:52-64`). */
export const MAX_WAIT_SECONDS = 900;

export const RunAgentInput = z
  .object({
    pull_request: z
      .string()
      .min(1)
      .describe('PR: a GitHub URL, `owner/repo#123`, or the pull-request UUID.'),
    agent: z.string().min(1).optional().describe('Agent name or id. Omit if only one is enabled.'),
    all_agents: z.boolean().default(false).describe('Run every enabled agent instead of one.'),
    max_wait_seconds: z
      .number()
      .int()
      .min(1)
      .max(MAX_WAIT_SECONDS)
      .default(MAX_WAIT_SECONDS)
      .describe('Give up waiting after this. The runs keep going; read them with get_findings.'),
    top_findings: z.number().int().min(0).max(20).default(5).describe('Findings to preview.'),
  })
  .strict();

/**
 * The ONLY tool with an `outputSchema`. It is small, and the model has to be
 * able to read `run_ids` back reliably — that is what makes a timeout
 * recoverable rather than a dead end.
 */
export const RunAgentOutput = z.object({
  status: z.enum(['completed', 'partial', 'failed', 'timeout', 'cancelled']),
  run_ids: z.array(z.string()),
  findings_total: z.number().int(),
  critical: z.number().int(),
  warning: z.number().int(),
  suggestion: z.number().int(),
});

export const runAgentOnPullRequest: ToolDescriptor = {
  name: 'run_agent_on_pull_request',
  config: {
    title: 'Run a review agent on a pull request',
    description: [
      'Run a DevDigest review agent over a pull request and WAIT for it to finish, then return a',
      'compact summary: score, blockers, severity counts, cost, and the top few findings.',
      'This CALLS GITHUB AND AN LLM AND SPENDS MONEY. Typical latency is tens of seconds, but',
      'runs of ~15 minutes happen. status is completed|partial|failed|timeout|cancelled — only',
      'the first two mean the PR was reviewed. Use get_findings for the full list of findings.',
      'Example: run_agent_on_pull_request({ pull_request: "acme/api#482", agent: "Security Reviewer" }).',
    ].join('\n'),
    inputSchema: RunAgentInput,
    outputSchema: RunAgentOutput,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      idempotentHint: false,
      // It writes rows and spends money, but it destroys nothing.
      destructiveHint: false,
    },
  },

  async handler(raw, deps, extra): Promise<ToolResult> {
    try {
      const input = RunAgentInput.parse(raw ?? {});
      return await run(input, deps, extra);
    } catch (err) {
      return failure(err);
    }
  },
};

async function run(
  input: z.infer<typeof RunAgentInput>,
  deps: Deps,
  extra: ToolExtra,
): Promise<ToolResult> {
  const progressToken = extra._meta?.progressToken;

  const outcome = await runReview(
    {
      pullRequest: input.pull_request,
      agent: input.agent,
      allAgents: input.all_agents,
      maxWaitSeconds: input.max_wait_seconds,
      topFindings: input.top_findings,
    },
    {
      api: deps.api,
      resolver: deps.resolver,
      signal: extra.signal,
      /*
       * This is what makes a 15-minute blocking call viable rather than
       * theoretical. `RequestOptions` on the client side carries
       * `resetTimeoutOnProgress`, so a client that sent a `progressToken` and
       * set that flag restarts its own timeout on every tick. No token means
       * the client did not ask, so nothing is sent.
       */
      onProgress: progressToken
        ? async ({ elapsedMs, pending, total }) => {
            await extra.sendNotification({
              method: 'notifications/progress',
              params: {
                progressToken,
                progress: total - pending,
                total,
                message: `${pending} of ${total} run(s) still going after ${Math.round(elapsedMs / 1000)}s`,
              },
            });
          }
        : undefined,
    },
  );

  switch (outcome.status) {
    case 'completed':
    case 'partial':
      // `partial` still renders the summary, because the runs that DID finish
      // produced real findings and dropping them would be the opposite
      // mistake. Each run line carries its own status and error, so the
      // failure is on the page rather than inferred from a count.
      return settled(outcome);
    case 'failed':
      return failed(outcome);
    default:
      return unfinished(outcome, input);
  }
}

function settled(o: RunReviewOutcome): ToolResult {
  const runLines = o.runs.map((r) => {
    const bits = [
      `${r.agent_name ?? r.agent_id ?? 'agent'}: ${r.status}`,
      r.score !== null ? `score ${r.score}` : null,
      r.blockers !== null ? `${r.blockers} blocker(s)` : null,
      r.findings_count !== null ? `${r.findings_count} finding(s)` : null,
      // null is UNKNOWN and 0 is free — never collapse them (server/INSIGHTS.md).
      r.cost_usd !== null ? `$${r.cost_usd.toFixed(6)}` : 'cost unknown',
      r.duration_ms !== null ? `${Math.round(r.duration_ms / 1000)}s` : null,
      r.grounding ? `grounding ${r.grounding}` : null,
      r.error ? `error: ${clamp(r.error, 200)}` : null,
    ].filter(Boolean);
    return `- ${bits.join(' · ')} (run ${r.run_id})`;
  });

  const failedRuns = o.runs.filter((r) => r.status !== 'done').length;
  const head =
    `${o.label}: ${o.runs.length} run(s) finished in ${Math.round(o.waitedMs / 1000)}s` +
    (failedRuns > 0 ? `, ${failedRuns} of them WITHOUT completing` : '') +
    `. ${o.totalFindings} finding(s) — ${o.severityCounts.CRITICAL} CRITICAL, ` +
    `${o.severityCounts.WARNING} WARNING, ${o.severityCounts.SUGGESTION} SUGGESTION.`;

  // Scores and grounding strings are reported exactly as read. Recomputing or
  // re-ranking them here would put a second, ungrounded scorer in the product.
  const preview =
    o.topFindings.length > 0
      ? `\nTop ${o.topFindings.length} finding(s):\n` +
        untrusted(
          'pull-request-findings',
          o.topFindings
            .map(
              (f) =>
                `${f.severity} ${f.category} ${lineRef(f.file, f.start_line, f.end_line)} — ${clamp(f.title, 160)}`,
            )
            .join('\n'),
        ) +
        `\nCall get_findings({ pull_request: "${o.label}" }) for all of them.`
      : '\nNo findings were recorded.';

  return {
    content: [
      {
        type: 'text',
        text: applyCharacterLimit(
          `${head}\n${runLines.join('\n')}${preview}`,
          'lower `top_findings`',
        ),
      },
    ],
    structuredContent: structured(o),
  };
}

/**
 * Emitted on EVERY path, including the `isError` ones.
 *
 * `outputSchema` exists here for exactly one reason — so a model can read the
 * outcome and the run ids without parsing prose — and that reason is strongest
 * precisely when something went wrong. An enum that advertises `failed`,
 * `timeout` and `cancelled` while the tool only ever emits `completed` and
 * `partial` structurally is an enum that lies: a caller switching on
 * `structuredContent.status` would fall through to `undefined` on every
 * outcome worth branching on.
 *
 * Legal, and checked rather than assumed —
 * `@modelcontextprotocol/sdk/dist/esm/server/mcp.js:193`:
 * `validateToolOutput` returns early on `result.isError`, so the payload is
 * forwarded to the client unvalidated rather than rejected.
 */
function structured(o: RunReviewOutcome): Record<string, unknown> {
  return {
    status: o.status,
    run_ids: o.runIds,
    findings_total: o.totalFindings,
    critical: o.severityCounts.CRITICAL,
    warning: o.severityCounts.WARNING,
    suggestion: o.severityCounts.SUGGESTION,
  };
}

/**
 * Every run reached a terminal state and NONE of them reached `done`.
 *
 * This is a distinct outcome from a timeout — the work is over, not still
 * going — and it is emphatically not a clean review. It gets `isError: true`
 * so no caller can read it as one, and it names each run's own error, because
 * "the executor deadline expired" and "the provider refused the request" want
 * different next moves from the reader.
 *
 * Found by running the tool for real: a 10-minute executor deadline settles a
 * run as `failed`, which is terminal, which used to end here as
 * `status: 'completed', findings_total: 0` — a clean bill of health for a pull
 * request that nothing had reviewed.
 */
function failed(o: RunReviewOutcome): ToolResult {
  const lines = o.runs.map((r) => {
    const who = r.agent_name ?? r.agent_id ?? 'agent';
    const why = r.error ? `: ${clamp(r.error, 300)}` : '';
    const spent = r.duration_ms !== null ? ` after ${Math.round(r.duration_ms / 1000)}s` : '';
    return `- ${who} — ${r.status ?? 'unknown'}${spent}${why} (run ${r.run_id})`;
  });

  return {
    ...textResult(
      `${o.label}: NO agent completed. ${o.runs.length} run(s) reached a terminal state and none of ` +
        `them is \`done\`, so this pull request has NOT been reviewed — do not read the absence of ` +
        `findings as an absence of problems.\n` +
        `${lines.join('\n')}\n` +
        `Run ids: ${o.runIds.join(', ')}\n` +
        `Retry with run_agent_on_pull_request, or check the run's trace in the DevDigest UI. ` +
        `Note that a cost of "unknown" does not mean the provider was not billed.`,
      true,
    ),
    structuredContent: structured(o),
  };
}

/**
 * Timeout and cancellation take the same shape: `isError: true`, every run id,
 * and the one instruction that recovers the work.
 *
 * The runs are deliberately NOT cancelled. `POST /runs/:id/cancel` frees the
 * executor but does not abort the request in flight — when the provider finally
 * answers, the run settles anyway (`server/INSIGHTS.md:38-64`). Cancelling would
 * pay for the run and throw the result away.
 *
 * The ids go in BOTH the text and `structuredContent` — see `structured()`.
 * An earlier version left the structured payload off here out of caution about
 * emitting it beside `isError`; reading the SDK settled it (validation is
 * skipped, the payload is still forwarded), and this is the path where a
 * machine-readable run id is worth the most.
 */
function unfinished(o: RunReviewOutcome, input: z.infer<typeof RunAgentInput>): ToolResult {
  const why =
    o.status === 'cancelled'
      ? 'The caller cancelled this tool call'
      : `Waited ${Math.round(o.waitedMs / 1000)}s of the ${input.max_wait_seconds}s budget`;
  const pending = o.runs
    .filter((r) => r.status === 'running' || r.status === null)
    .map((r) => r.agent_name ?? r.run_id);

  return {
    ...textResult(
      `${why}; ${o.runs.length > 0 ? `${pending.length} of ${o.runs.length}` : 'the'} run(s) are still going.\n` +
        `The runs were NOT cancelled and are still being billed to completion — cancelling does not ` +
        `abort the request in flight, it only discards the result.\n` +
        `Run ids: ${o.runIds.join(', ')}\n` +
        `Read the result later with get_findings({ pull_request: "${o.label}" }).`,
      true,
    ),
    structuredContent: structured(o),
  };
}

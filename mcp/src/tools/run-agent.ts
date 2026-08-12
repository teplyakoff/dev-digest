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
  status: z.enum(['completed', 'timeout', 'cancelled']),
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
      'runs of ~15 minutes have happened; on timeout it returns the run ids and keeps going.',
      'Use get_findings for the full list — this never dumps every finding.',
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

  return outcome.status === 'completed' ? completed(outcome) : unfinished(outcome, input);
}

function completed(o: RunReviewOutcome): ToolResult {
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

  const head =
    `${o.label}: ${o.runs.length} run(s) finished in ${Math.round(o.waitedMs / 1000)}s. ` +
    `${o.totalFindings} finding(s) — ${o.severityCounts.CRITICAL} CRITICAL, ` +
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
    structuredContent: {
      status: o.status,
      run_ids: o.runIds,
      findings_total: o.totalFindings,
      critical: o.severityCounts.CRITICAL,
      warning: o.severityCounts.WARNING,
      suggestion: o.severityCounts.SUGGESTION,
    },
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
 * No `structuredContent` on this path: the SDK skips output validation entirely
 * when `isError` is set (`server/mcp.js:185-195`), so the ids have to be, and
 * are, in the text.
 */
function unfinished(o: RunReviewOutcome, input: z.infer<typeof RunAgentInput>): ToolResult {
  const why =
    o.status === 'cancelled'
      ? 'The caller cancelled this tool call'
      : `Waited ${Math.round(o.waitedMs / 1000)}s of the ${input.max_wait_seconds}s budget`;
  const pending = o.runs
    .filter((r) => r.status === 'running' || r.status === null)
    .map((r) => r.agent_name ?? r.run_id);

  return textResult(
    `${why}; ${o.runs.length > 0 ? `${pending.length} of ${o.runs.length}` : 'the'} run(s) are still going.\n` +
      `The runs were NOT cancelled and are still being billed to completion — cancelling does not ` +
      `abort the request in flight, it only discards the result.\n` +
      `Run ids: ${o.runIds.join(', ')}\n` +
      `Read the result later with get_findings({ pull_request: "${o.label}" }).`,
    true,
  );
}

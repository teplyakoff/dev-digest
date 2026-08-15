import { z } from 'zod';
import type { ToolResult } from '../api/types.js';
import type { Deps } from '../deps.js';
import { clamp, applyCharacterLimit, textResult, untrusted } from '../format.js';
import { failure, type ToolDescriptor } from './types.js';

export const ListAgentsInput = z
  .object({
    enabled_only: z
      .boolean()
      .default(true)
      .describe('Only agents that are switched on. false also returns disabled ones.'),
    include_prompt: z
      .boolean()
      .default(false)
      .describe('Include each agent system prompt. Expensive — prompts run to hundreds of lines.'),
  })
  .strict();

/**
 * The reference implementation: one client call and a projection, so no ring-2
 * service. onion §13 names "a service that only forwards to a repository" as an
 * antipattern, and a `list-agents` use case would be exactly that.
 *
 * `include_prompt: false` skipping `system_prompt` is the single biggest token
 * lever this tool has — seeded prompts run to hundreds of lines each.
 */
export const listAgents: ToolDescriptor = {
  name: 'list_agents',
  config: {
    title: 'List review agents',
    description: [
      'List the DevDigest review agents in this workspace: name, provider, model, enabled, and how',
      'many skills each has linked. Use it first to choose `agent` for run_agent_on_pull_request,',
      'or to find which agent produced a finding.',
      'Do NOT use this to edit an agent or read its version history — neither is exposed here.',
      'Examples: list_agents({}) → enabled agents.',
      'list_agents({ enabled_only: false, include_prompt: true }) → everything, verbose.',
    ].join('\n'),
    inputSchema: ListAgentsInput,
    // No outputSchema on purpose — see README's token budget. Four of the five
    // tools return `content` only.
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  },

  async handler(raw, deps, extra): Promise<ToolResult> {
    try {
      const input = ListAgentsInput.parse(raw ?? {});
      return await run(input, deps, extra.signal);
    } catch (err) {
      return failure(err);
    }
  },
};

async function run(
  input: z.infer<typeof ListAgentsInput>,
  deps: Deps,
  signal: AbortSignal,
): Promise<ToolResult> {
  const all = await deps.api.listAgents(signal);
  const agents = input.enabled_only ? all.filter((a) => a.enabled) : all;

  if (agents.length === 0) {
    return textResult(
      input.enabled_only && all.length > 0
        ? `No ENABLED agents (${all.length} exist but are switched off). Call again with enabled_only: false to see them.`
        : 'No review agents exist in this workspace yet. Create one in the DevDigest UI.',
    );
  }

  const lines = agents.map((a) => {
    const head =
      `${a.name} — ${a.provider}/${a.model} · ${a.enabled ? 'enabled' : 'disabled'}` +
      ` · ${a.skills_count ?? 0} skill(s) · strategy ${a.strategy} · id ${a.id}`;
    const desc = a.description.trim().length > 0 ? `\n  ${clamp(a.description, 200)}` : '';
    // An agent's system prompt is configuration its owner wrote, so the REVIEW
    // model treats it as instruction. To the model reading this tool result it
    // is somebody else's instruction text arriving as data — which is precisely
    // the case `wrapUntrusted` exists for. Wrapped, and labelled with the agent.
    const prompt = input.include_prompt
      ? `\n${untrusted(`agent-system-prompt:${a.name}`, a.system_prompt)}`
      : '';
    return `${head}${desc}${prompt}`;
  });

  const header =
    `${agents.length} review agent(s)` + (input.enabled_only ? ' (enabled only)' : '') + ':';

  return textResult(
    applyCharacterLimit(
      [header, ...lines].join('\n'),
      'call with include_prompt: false, or with enabled_only: true',
    ),
  );
}

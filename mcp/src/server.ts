import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { HttpApiClient } from './api/client.js';
import type { ApiClient } from './api/types.js';
import type { Deps } from './deps.js';
import type { McpConfig } from './config.js';
import { Resolver } from './resolve.js';
import { TOOLS } from './tools/index.js';

/**
 * The composition root. The one place that constructs adapters (onion §6) and
 * the one place that touches the MCP SDK.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NEVER ADD PROMPT ASSEMBLY OR A MODEL CALL TO THIS PACKAGE.
 *
 * `INJECTION_GUARD` (`reviewer-core/src/prompt.ts:197-198`) is the single shared
 * prompt-injection defense, and it runs because every review path goes through
 * `assemblePrompt`. A model call made from here would be a new review path with
 * no guard on it — the exact invariant AGENTS.md says never to break silently.
 * This server talks HTTP to the local API and nothing else; the borrowed
 * `wrapUntrusted` in `format.ts` is the only thing it takes from the engine, and
 * it points the other way (protecting the CALLER's model from what we return).
 * `eslint.config.js` fails the build on an `openai` or reviewer-core-barrel
 * import so this comment is not the only thing holding it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Short on purpose: every call pays for `mcp__devdigest__<tool>` in tokens. */
export const SERVER_NAME = 'devdigest';

export function buildServer(config: McpConfig, apiOverride?: ApiClient): McpServer {
  const api = apiOverride ?? new HttpApiClient(config.apiUrl);
  const deps: Deps = { api, resolver: new Resolver(api) };

  const server = new McpServer(
    { name: SERVER_NAME, version: '0.1.0' },
    {
      capabilities: { tools: {} },
      // `instructions` is deliberately OMITTED. Five tool descriptions already
      // carry the routing information it would repeat, and it is paid for in
      // every session's system prompt. See README's token budget.
    },
  );

  for (const tool of TOOLS) {
    // The third argument is why this is a loop and not five calls: `extra`
    // carries `signal` (client cancellation) and `sendNotification` +
    // `_meta.progressToken` (progress). Dropping it makes the 15-minute
    // blocking call both uninterruptible and invisible.
    server.registerTool(tool.name, tool.config, (input, extra) =>
      tool.handler(input, deps, extra),
    );
  }

  return server;
}

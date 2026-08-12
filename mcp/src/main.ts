import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { log } from './log.js';
import { buildServer } from './server.js';

/**
 * Entry point. Reads the environment, builds the graph, speaks JSON-RPC on
 * stdin/stdout. Every diagnostic goes to stderr — stdout is the protocol.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const server = buildServer(config);
  await server.connect(new StdioServerTransport());
  log.info('ready on stdio', { api: config.apiUrl });
}

main().catch((err: unknown) => {
  // A bad DEVDIGEST_API_URL lands here. Exit non-zero so the MCP client reports
  // a failed server instead of an idle one that answers nothing.
  log.error((err as Error)?.message ?? String(err));
  process.exit(1);
});

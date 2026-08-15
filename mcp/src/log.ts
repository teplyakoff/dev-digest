/**
 * stderr-only logging.
 *
 * On a stdio MCP server stdout carries framed JSON-RPC and nothing else. A
 * single stray `console.log` corrupts the stream, and the client reports a
 * protocol parse error rather than a stray log line — so the lint lane bans
 * `console.log` and `process.stdout` in `src/**` and this file is the sanctioned
 * way out.
 */

function emit(level: 'info' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>): void {
  const suffix = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : '';
  // console.error writes to stderr for every level on purpose: stderr is the
  // whole diagnostic channel here, and level lives in the text.
  console.error(`[devdigest-mcp] ${level}: ${msg}${suffix}`);
}

export const log = {
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};

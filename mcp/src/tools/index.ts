import { getBlastRadius } from './get-blast-radius.js';
import { getConventions } from './get-conventions.js';
import { getFindings } from './get-findings.js';
import { listAgents } from './list-agents.js';
import { runAgentOnPullRequest } from './run-agent.js';
import type { ToolDescriptor } from './types.js';

/**
 * The registry. **Exactly five tools, and that is a budget, not a coincidence.**
 *
 * Tool definitions are injected into the system prompt of every chat in this
 * repo — including agents that will never call them — at roughly 1 650 tokens
 * for these five, against a hard ceiling of 2 000. A sixth tool costs 200–550
 * before it does anything. See `README.md` for the per-tool breakdown and the
 * levers that hold the number down.
 */
export const TOOLS: readonly ToolDescriptor[] = [
  listAgents,
  getFindings,
  getConventions,
  runAgentOnPullRequest,
  // Registered although it always fails: a visibly unimplemented tool reports
  // its own absence, a hidden one is indistinguishable from never asking.
  getBlastRadius,
];

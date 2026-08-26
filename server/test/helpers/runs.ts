import * as t from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { PgFixture } from './pg.js';

/**
 * `runReview` is fire-and-forget: the POST returns runIds immediately and each
 * agent's review is persisted in the background (the client subscribes to SSE).
 * Tests that assert on persisted reviews/findings/traces must first wait for the
 * background runs to finish. This polls `agent_runs` until every row for the PR
 * reaches a terminal status (done / failed / cancelled).
 */
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

export async function waitForPrRuns(
  db: PgFixture['handle']['db'],
  prId: string,
  opts: { expected?: number; timeoutMs?: number } = {},
): Promise<Array<typeof t.agentRuns.$inferSelect>> {
  const { expected, timeoutMs = 10_000 } = opts;
  const start = Date.now();
  for (;;) {
    const runs = await db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, prId));
    const terminal = runs.filter((r) => TERMINAL.has(r.status ?? ''));
    // With an explicit `expected`, wait until that many runs finish (ignores any
    // extra rows, e.g. a trifecta scan). Otherwise wait for all rows to settle.
    const done =
      expected != null
        ? terminal.length >= expected
        : runs.length > 0 && terminal.length === runs.length;
    if (done) return runs;
    if (Date.now() - start > timeoutMs) return runs;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * Wait until a run's TRACE row exists, not merely until the run is terminal.
 *
 * These are two different moments, and the gap between them is real: the
 * executor sets `status: 'done'` inside its persistence transaction and calls
 * `saveRunTrace` AFTER that transaction commits. `waitForPrRuns` watches the
 * status, so it can return in the window where the run is finished and the trace
 * has not been written yet.
 *
 * Under load that window opens wide enough to matter — it failed a `--full`
 * suite run here, and the symptom is a bare
 * `Cannot read properties of undefined (reading 'skills')` pointing at the
 * assertion rather than at the ordering, which is what makes it expensive to
 * diagnose from the failure alone.
 *
 * The executor's ordering is correct and is deliberately left alone: the run's
 * terminal status is the truth, the trace is reporting, and a trace written
 * before the run settled would be a record of something that had not happened.
 * So the wait belongs here, once, rather than in each test that reads a trace.
 */
export async function waitForRunTrace(
  db: PgFixture['handle']['db'],
  runId: string,
  opts: { timeoutMs?: number } = {},
): Promise<typeof t.runTraces.$inferSelect | undefined> {
  const { timeoutMs = 10_000 } = opts;
  const start = Date.now();
  for (;;) {
    const [row] = await db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
    if (row) return row;
    if (Date.now() - start > timeoutMs) return undefined;
    await new Promise((r) => setTimeout(r, 25));
  }
}

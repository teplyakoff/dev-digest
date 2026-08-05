import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Regression tests for the run-settle transition guard.
 *
 * THE BUG: `POST /runs/:id/cancel` marks a run `cancelled` but cannot abort the
 * provider request that is already in flight. When that request finally returned
 * — up to 16 minutes later, per `server/INSIGHTS.md` — `completeAgentRun` wrote
 * the row straight back to `done`, with a real `cost_usd`. A run the user
 * cancelled and watched turn grey silently un-cancelled itself and got billed.
 *
 * `server/INSIGHTS.md` names three runs this happened to (2026-07-28), cancelled
 * at 13:29:27Z, screenshotted as `cancelled` at 13:42Z, reading `done` after.
 * These tests pin the transition table that fixes it.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('agent run settle guard (Testcontainers pg)', () => {
  let pg: PgFixture;
  let repo: ReviewRepository;
  let workspaceId: string;
  let prId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
    repo = new ReviewRepository(pg.handle.db);
    const [pr] = await pg.handle.db.select().from(t.pullRequests);
    prId = pr!.id;
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  });

  const newRun = () =>
    repo.createAgentRun({
      workspaceId,
      agentId: null,
      prId,
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
    });

  const statusOf = async (runId: string) => {
    const [row] = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.id, runId));
    return row!;
  };

  const settle = (
    runId: string,
    status: 'done' | 'failed' | 'cancelled',
    costUsd: number | null,
  ) =>
    repo.completeAgentRun(runId, {
      status,
      durationMs: 1234,
      tokensIn: 10,
      tokensOut: 20,
      costUsd,
      findingsCount: 0,
      grounding: '0/0 passed',
      error: status === 'done' ? null : 'boom',
    });

  it('running → done settles normally and reports that it applied', async () => {
    const runId = await newRun();
    expect(await settle(runId, 'done', 0.0016)).toBe(true);

    const row = await statusOf(runId);
    expect(row.status).toBe('done');
    expect(row.costUsd).toBe(0.0016);
  });

  // The actual bug.
  it('a cancelled run is NOT resurrected as done by a late provider response', async () => {
    const runId = await newRun();
    expect(await repo.cancelRunIfRunning(runId)).toBe(true);

    // …minutes later, the provider finally answers and the executor tries to
    // settle the run it thinks it still owns.
    expect(await settle(runId, 'done', 0.0016)).toBe(false);

    const row = await statusOf(runId);
    expect(row.status).toBe('cancelled');
    // And — the part that costs money — no cost is attributed to it.
    expect(row.costUsd).toBeNull();
  });

  // The executor's own catch path still needs to record WHY and for how long,
  // on a row the cancel endpoint had already flipped (it writes status only).
  it('a cancelled run can still be filled in with its duration and reason', async () => {
    const runId = await newRun();
    await repo.cancelRunIfRunning(runId);

    expect(await settle(runId, 'cancelled', null)).toBe(true);

    const row = await statusOf(runId);
    expect(row.status).toBe('cancelled');
    expect(row.durationMs).toBe(1234);
    expect(row.error).toBe('boom');
    // Cancelled mid-flight may still have burned tokens nobody can account for:
    // UNKNOWN (null), never a misleading 0.00.
    expect(row.costUsd).toBeNull();
  });

  it('a boot-reaped failed run is not flipped to done either', async () => {
    const runId = await newRun();
    expect(await repo.reapStaleRunningRuns()).toBeGreaterThan(0);
    expect((await statusOf(runId)).status).toBe('failed');

    expect(await settle(runId, 'done', 0.5)).toBe(false);

    const row = await statusOf(runId);
    expect(row.status).toBe('failed');
    expect(row.costUsd).toBeNull();
  });
});

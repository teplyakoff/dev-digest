import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EvalBatchCompare, EvalDashboard, type LLMProvider } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import {
  MockGitClient,
  MockGitHubClient,
  MockSecretsProvider,
  MockSourceReader,
} from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals-compare] Docker not available — skipping integration tests.');
}

/**
 * L06 / SPEC-08 — reading batches back: the dashboard, the regression banner and
 * the two-batch comparison (AC-43, AC-55…AC-59, NFR-6).
 *
 * The batches here are INSERTED, not run. That is deliberate: what is under
 * test is how persisted aggregates are read, compared and turned into a banner,
 * and a real run would make those aggregates a consequence of a mock fixture
 * rather than a value the test chose. `evals-batch.it.test.ts` covers the
 * writing side, where the numbers must be earned.
 *
 * ## Zero model calls, proved rather than promised
 *
 * The whole app is built with a provider that THROWS on every method. AC-55 and
 * AC-57 say the aggregates and the banner are produced with no model call, and
 * a stub that answered cheaply would only show that the call was cheap. Every
 * request in this file answers, which means none of them reached it.
 *
 * FILE NAME IS LOAD-BEARING: `*.it.test.ts` is how the CI suite split finds the
 * Docker-requiring tests.
 */

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Reaching this is the failure, so it is loud rather than silently counted. */
class ThrowingLLM implements LLMProvider {
  readonly id = 'openrouter' as const;
  listModels(): never {
    throw new Error('the eval dashboard called listModels — it must cost zero tokens');
  }
  complete(): never {
    throw new Error('the eval dashboard called complete — it must cost zero tokens');
  }
  completeStructured(): never {
    throw new Error('the eval dashboard called completeStructured — it must cost zero tokens');
  }
  embed(): never {
    throw new Error('the eval dashboard called embed — it must cost zero tokens');
  }
}

interface BatchSpec {
  startedAt: string;
  status?: 'running' | 'complete' | 'partial' | 'failed';
  recall?: number | null;
  precision?: number | null;
  citationAccuracy?: number | null;
  costUsd?: number | null;
  casesTotal?: number;
  casesCompleted?: number;
  model?: string;
  provider?: 'openai' | 'anthropic' | 'openrouter';
  systemPromptSnapshot?: string | null;
}

d('the eval dashboard and the two-batch comparison', () => {
  let pg: PgFixture;
  let db: PgFixture['handle']['db'];
  let app: Awaited<ReturnType<typeof buildApp>>;
  let workspaceId: string;

  let agentSeq = 0;

  async function makeAgent() {
    const [agent] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        name: `Dashboard Agent ${agentSeq++}`,
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        systemPrompt: 'You are a reviewer.',
      })
      .returning();
    const [evalCase] = await db
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agent!.id,
        name: 'a-case',
        inputDiff: 'diff --git a/x b/x',
        expectedOutput: [],
        expectation: 'must_not_flag',
      })
      .returning();
    return { agentId: agent!.id, caseId: evalCase!.id };
  }

  async function addBatch(agentId: string, spec: BatchSpec) {
    const [batch] = await db
      .insert(t.evalRunBatches)
      .values({
        workspaceId,
        agentId,
        agentVersion: 1,
        systemPromptSnapshot:
          spec.systemPromptSnapshot === undefined ? 'snapshot' : spec.systemPromptSnapshot,
        provider: spec.provider ?? 'openrouter',
        model: spec.model ?? 'deepseek/deepseek-v4-flash',
        status: spec.status ?? 'complete',
        casesTotal: spec.casesTotal ?? 4,
        casesCompleted: spec.casesCompleted ?? 4,
        recall: spec.recall ?? null,
        precision: spec.precision ?? null,
        citationAccuracy: spec.citationAccuracy ?? null,
        costUsd: spec.costUsd ?? null,
        startedAt: new Date(spec.startedAt),
        finishedAt: spec.status === 'running' ? null : new Date(spec.startedAt),
      })
      .returning();
    return batch!;
  }

  async function addRuns(batchId: string, caseId: string, statuses: ('passed' | 'failed' | 'errored')[]) {
    await db.insert(t.evalRuns).values(
      statuses.map((status, i) => ({
        caseId,
        batchId,
        status,
        pass: status === 'passed',
        durationMs: 100 + i,
        ranAt: new Date(Date.parse('2026-08-27T09:00:00.000Z') + i * 1000),
      })),
    );
  }

  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;
    const seeded = await seed(db);
    workspaceId = seeded.workspaceId;

    app = await buildApp({
      config: config(),
      db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        sourceReader: new MockSourceReader({}),
        llm: { openrouter: new ThrowingLLM() },
      },
    });
    await app.ready();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('raises the regression banner when recall fell by a point, without a model call (AC-56, AC-57)', async () => {
    const { agentId, caseId } = await makeAgent();
    await addBatch(agentId, { startedAt: '2026-08-26T10:00:00.000Z', recall: 0.6, precision: 0.6 });
    const newer = await addBatch(agentId, {
      startedAt: '2026-08-27T10:00:00.000Z',
      recall: 0.5,
      precision: 0.6,
      status: 'partial',
      casesTotal: 4,
      casesCompleted: 3,
    });
    await addRuns(newer.id, caseId, ['passed', 'passed', 'failed', 'errored']);

    const res = await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-dashboard` });
    expect(res.statusCode).toBe(200);
    const dash = EvalDashboard.parse(res.json());

    expect(dash.alert).toContain('recall');
    expect(dash.alert).toContain('60.0%');
    expect(dash.alert).toContain('50.0%');
    // Precision did not move, so it is not in the banner — a banner that lists
    // every metric whether or not it regressed is a banner nobody reads.
    expect(dash.alert).not.toContain('precision');

    // The delta is the movement, and it is a NUMBER here because both sides are
    // known.
    expect(dash.delta?.recall).toBeCloseTo(-0.1, 10);
    expect(dash.delta?.precision).toBe(0);

    // AC-43 — every response carrying aggregates carries the partial flag.
    expect(dash.current.partial).toBe(true);
    expect(dash.current.traces_passed).toBe(2);
    expect(dash.current.traces_total).toBe(4);

    // The trend reads left to right, oldest first.
    expect(dash.trend.map((p) => p.recall)).toEqual([0.6, 0.5]);
  });

  it('returns an EMPTY banner and a null delta when there is no previous batch (AC-58)', async () => {
    const { agentId } = await makeAgent();
    await addBatch(agentId, { startedAt: '2026-08-27T10:00:00.000Z', recall: 0.2, precision: 0.2 });

    const dash = EvalDashboard.parse(
      (await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-dashboard` })).json(),
    );

    // A first batch with terrible numbers has not regressed from anything.
    expect(dash.alert).toBe('');
    // AC-73's absence, on the server side: `null` as a whole, not three zeroes.
    // Three zeroes would render as "▲ 0pt" beside every first batch.
    expect(dash.delta).toBeNull();
  });

  it('does not mention a metric that is unknown in either batch (AC-59)', async () => {
    const { agentId } = await makeAgent();
    await addBatch(agentId, {
      startedAt: '2026-08-26T10:00:00.000Z',
      recall: null,
      precision: 0.9,
    });
    await addBatch(agentId, { startedAt: '2026-08-27T10:00:00.000Z', recall: 0.1, precision: 0.5 });

    const dash = EvalDashboard.parse(
      (await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-dashboard` })).json(),
    );

    // Recall went from unknown to 10%. That is not a 90-point collapse, it is
    // not a collapse at all, and the banner must not claim one.
    expect(dash.alert).not.toContain('recall');
    expect(dash.alert).toContain('precision');
    expect(dash.delta?.recall).toBeNull();
    expect(dash.delta?.precision).toBeCloseTo(-0.4, 10);
  });

  it('reports three dashes, not zeroes, for an agent that has never run a batch', async () => {
    const { agentId } = await makeAgent();

    const dash = EvalDashboard.parse(
      (await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-dashboard` })).json(),
    );

    // `0` here would read as a real, terrible score for an agent that has never
    // been measured — the exact confusion the whole spec is organised against.
    expect(dash.current.recall).toBeNull();
    expect(dash.current.precision).toBeNull();
    expect(dash.current.citation_accuracy).toBeNull();
    expect(dash.current.cost_usd).toBeNull();
    expect(dash.delta).toBeNull();
    expect(dash.latest_batch).toBeNull();
    expect(dash.alert).toBe('');
    expect(dash.cases_total).toBe(1);
  });

  it('keeps `current` on the last FINISHED batch while a new one is running', async () => {
    const { agentId } = await makeAgent();
    await addBatch(agentId, { startedAt: '2026-08-26T10:00:00.000Z', recall: 0.8, precision: 0.8 });
    const running = await addBatch(agentId, {
      startedAt: '2026-08-27T10:00:00.000Z',
      status: 'running',
      casesCompleted: 1,
    });

    const dash = EvalDashboard.parse(
      (await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-dashboard` })).json(),
    );

    // Two channels, two answers. `current` keeps the last real numbers so a run
    // in flight does not blank the screen for as long as it takes; `latest_batch`
    // carries the lifecycle so a tab that never saw the 202 can still tell that
    // a batch is running and keep the run action disabled.
    expect(dash.current.recall).toBeCloseTo(0.8, 10);
    expect(dash.latest_batch?.id).toBe(running.id);
    expect(dash.latest_batch?.status).toBe('running');
    // A running batch is not in the trend — it has no aggregates yet.
    expect(dash.trend).toHaveLength(1);
  });

  it('compares two batches and reports every delta (NFR-6)', async () => {
    const { agentId } = await makeAgent();
    const a = await addBatch(agentId, {
      startedAt: '2026-08-26T10:00:00.000Z',
      recall: 0.4,
      precision: 0.5,
      citationAccuracy: 0.8,
      costUsd: 0.002,
    });
    const b = await addBatch(agentId, {
      startedAt: '2026-08-27T10:00:00.000Z',
      recall: 0.7,
      precision: 0.5,
      citationAccuracy: 0.9,
      costUsd: 0.003,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/eval-batches/compare?a=${a.id}&b=${b.id}`,
    });
    expect(res.statusCode).toBe(200);
    const cmp = EvalBatchCompare.parse(res.json());

    expect(cmp.deltas.recall).toBeCloseTo(0.3, 10);
    expect(cmp.deltas.precision).toBe(0);
    expect(cmp.deltas.citation_accuracy).toBeCloseTo(0.1, 10);
    expect(cmp.deltas.cost_usd).toBeCloseTo(0.001, 12);
    expect(cmp.comparable).toBe(true);
    expect(cmp.prompt_diff_available).toBe(true);
  });

  it('marks the comparison INCOMPARABLE when the model or provider differ (NFR-6)', async () => {
    const { agentId } = await makeAgent();
    const a = await addBatch(agentId, { startedAt: '2026-08-26T10:00:00.000Z', recall: 0.4 });
    const b = await addBatch(agentId, {
      startedAt: '2026-08-27T10:00:00.000Z',
      recall: 0.9,
      model: 'anthropic/claude-4-haiku',
    });

    const cmp = EvalBatchCompare.parse(
      (
        await app.inject({ method: 'GET', url: `/eval-batches/compare?a=${a.id}&b=${b.id}` })
      ).json(),
    );

    // The deltas are still computed — the flag says what they MEAN, not whether
    // they exist. A 50-point recall move between two different models says
    // nothing about the prompt, which is the only thing the comparison is for.
    expect(cmp.comparable).toBe(false);
    expect(cmp.deltas.recall).toBeCloseTo(0.5, 10);
  });

  it('reports a delta as unknown when the metric is unknown on either side', async () => {
    const { agentId } = await makeAgent();
    const a = await addBatch(agentId, { startedAt: '2026-08-26T10:00:00.000Z', recall: null, costUsd: null });
    const b = await addBatch(agentId, { startedAt: '2026-08-27T10:00:00.000Z', recall: 0.9, costUsd: 0.004 });

    const cmp = EvalBatchCompare.parse(
      (
        await app.inject({ method: 'GET', url: `/eval-batches/compare?a=${a.id}&b=${b.id}` })
      ).json(),
    );

    expect(cmp.deltas.recall).toBeNull();
    expect(cmp.deltas.recall).not.toBe(0.9);
    // The same rule for money: a batch whose cost is unknown has not become
    // $0.004 cheaper or dearer than anything.
    expect(cmp.deltas.cost_usd).toBeNull();
  });

  it('says a prompt diff is unavailable when a batch carries no snapshot', async () => {
    const { agentId } = await makeAgent();
    const a = await addBatch(agentId, {
      startedAt: '2026-08-26T10:00:00.000Z',
      systemPromptSnapshot: null,
    });
    const b = await addBatch(agentId, { startedAt: '2026-08-27T10:00:00.000Z' });

    const cmp = EvalBatchCompare.parse(
      (
        await app.inject({ method: 'GET', url: `/eval-batches/compare?a=${a.id}&b=${b.id}` })
      ).json(),
    );

    expect(cmp.prompt_diff_available).toBe(false);
  });

  it('404s a comparison naming a batch that does not exist', async () => {
    const { agentId } = await makeAgent();
    const a = await addBatch(agentId, { startedAt: '2026-08-26T10:00:00.000Z' });

    const res = await app.inject({
      method: 'GET',
      url: `/eval-batches/compare?a=${a.id}&b=00000000-0000-0000-0000-000000000000`,
    });

    expect(res.statusCode).toBe(404);
  });

  it('resolves the static `compare` segment ahead of `/eval-batches/:id`', async () => {
    // Both routes reject a malformed request with 422, so the STATUS cannot
    // tell them apart. The validation message can: only the compare route
    // declares a querystring, so a body complaining about `a` and `b` proves
    // the request reached it rather than being swallowed by `/:id` with
    // `compare` bound as a (non-uuid) id.
    const res = await app.inject({ method: 'GET', url: '/eval-batches/compare' });

    expect(res.statusCode).toBe(422);
    const body = JSON.stringify(res.json());
    // The validation error names the missing `a` and `b` — the compare route's
    // own querystring — and says nothing about `id`, which is what the
    // parameterised route would have complained about had it won the match.
    expect(body).toContain('"instancePath":"/a"');
    expect(body).toContain('"instancePath":"/b"');
    expect(body).not.toContain('"instancePath":"/id"');
  });

  it('answered every request above without ever resolving a provider (AC-55, AC-57)', () => {
    // Structural restatement: the only provider this app can resolve throws on
    // every method, and every request in this file returned a body. If the
    // dashboard or the banner had reached a model, those tests would have
    // failed with the stub's message rather than passing.
    expect(new ThrowingLLM().id).toBe('openrouter');
    expect(() => new ThrowingLLM().completeStructured()).toThrow(/zero tokens/);
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import type {
  CompletionRequest,
  CompletionResult,
  LLMProvider,
  ModelInfo,
  Review,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { EvalService } from '../src/modules/evals/service.js';
import * as t from '../src/db/schema.js';
import {
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockSecretsProvider,
  MockSourceReader,
} from '../src/adapters/mocks.js';

/**
 * L06 / SPEC-08 — the two BOUNDS the eval pipeline enforces: the per-case
 * wall-clock ceiling (NFR-10) and the batch rate limit (NFR-4). Both were
 * implemented with no test anywhere in the repo; the conformance audit found
 * them, and this file is the handle they lost.
 *
 * FILE NAME IS LOAD-BEARING: `*.it.test.ts` is how the CI suite split finds the
 * Docker-requiring tests (`server/CLAUDE.md`). Both halves genuinely need a
 * database — a batch writes `eval_run_batches` + `eval_runs`, and the rate-limit
 * half needs a real agent row for the request to reach its refusal.
 *
 * ## Why the ceiling constant is mocked, and what that costs
 *
 * `CASE_TIMEOUT_MS` is 120 000. The three ways to reach it were: wait two
 * minutes per case (a two-minute unit test nobody will keep), reach in with
 * `(service as any)` (banned), or wrap fake timers around a live postgres-js
 * connection (its own timers are on that clock too — that is how you wedge the
 * driver). None of those is the test.
 *
 * So the module is mocked, `CASE_TIMEOUT_MS` alone is overridden, and every
 * other constant passes through `importOriginal` untouched — this is a TEST
 * substitution, not a production change; nothing in `src/` moved to make it
 * work. What that buys is the MECHANISM under a clock that still ticks
 * normally: a real `setTimeout`, a real `AbortController`, a real
 * `Promise.race`. What it deliberately does NOT prove is the NUMBER, so the
 * number is asserted separately against the unmocked module below — the pair
 * covers "the ceiling is 120 s" and "exceeding the ceiling errors the case and
 * spares the batch" without either test pretending to do the other's job.
 */

const { TEST_CEILING_MS } = vi.hoisted(() => ({ TEST_CEILING_MS: 2_000 }));

vi.mock('../src/modules/evals/constants.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/evals/constants.js')>();
  return { ...actual, CASE_TIMEOUT_MS: TEST_CEILING_MS };
});

/** The REAL module, for the assertions that are about the shipped values. */
const REAL = await vi.importActual<typeof import('../src/modules/evals/constants.js')>(
  '../src/modules/evals/constants.js',
);

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals-limits] Docker not available — skipping integration tests.');
}

const ALPHA_DIFF = [
  'diff --git a/src/alpha.ts b/src/alpha.ts',
  '--- a/src/alpha.ts',
  '+++ b/src/alpha.ts',
  '@@ -0,0 +1,3 @@',
  '+const a = 1;',
  '+const stripeKey = "sk_live_xxx";',
  '+const c = 3;',
].join('\n');

const ALPHA_FINDING: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/alpha.ts',
      start_line: 2,
      end_line: 2,
      rationale: 'A live Stripe key is committed in source.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

/**
 * A provider that ANSWERS every call except one, which it leaves hanging — the
 * shape of the failure NFR-10 exists for: a provider that has accepted the
 * request and will not answer.
 *
 * The hung call never settles, by design. Rejecting it on abort would make the
 * assertion below a microtask race between two rejections (the provider's and
 * the ceiling's) for the same `Promise.race`, and the recorded error message
 * would flip between them run to run. Staying pending makes the ceiling the
 * only possible winner, which is exactly the claim under test.
 *
 * `abortObserved` is the other half of the mechanism: the service aborts its
 * `AbortController` before it rejects, and a well-behaved provider is supposed
 * to see that. If the signal ever stops being threaded through
 * `buildEvalReviewInput` → `reviewPullRequest` → `completeStructured`, this
 * flag stays false and the test fails while the ceiling still "works".
 */
class HangingLLM implements LLMProvider {
  readonly id = 'openai' as const;
  public calls = 0;
  public abortObserved = false;

  constructor(private hangOnCall: number) {}

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'gpt-4.1', provider: 'openai' }];
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return { text: '', model: req.model, tokensIn: 0, tokensOut: 0, costUsd: 0 };
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const n = ++this.calls;
    if (n === this.hangOnCall) {
      req.signal?.addEventListener('abort', () => {
        this.abortObserved = true;
      });
      return new Promise<StructuredResult<T>>(() => {
        /* never settles — the provider took the request and went quiet */
      });
    }
    // Same discipline as `MockLLMProvider`: parse the canned answer against the
    // CALLER's schema so a contract change breaks the fixture loudly.
    const parsed = req.schema.safeParse(ALPHA_FINDING);
    if (!parsed.success) throw new Error(`HangingLLM fixture failed schema: ${parsed.error.message}`);
    return {
      data: parsed.data,
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: '{}',
      attempts: 1,
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => []);
  }
}

const overrides = (llm: LLMProvider) => ({
  // The empty `MockSecretsProvider` is the load-bearing override, not the LLM
  // one: a port nobody remembered to inject then raises `ConfigError` instead
  // of falling through to the real keys in `server/.env` and billing a live
  // call (`server/INSIGHTS.md`, 2026-08-06).
  secrets: new MockSecretsProvider({}),
  git: new MockGitClient(),
  github: new MockGitHubClient(),
  sourceReader: new MockSourceReader({}),
  llm: { openrouter: llm },
});

d('NFR-10 — the per-case ceiling', () => {
  let pg: PgFixture;
  let db: PgFixture['handle']['db'];
  let workspaceId: string;
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;
    workspaceId = (await seed(db)).workspaceId;
  }, 180_000);

  afterAll(async () => {
    for (const app of apps) await app.close();
    await pg?.stop();
  });

  async function appWith(llm: LLMProvider) {
    const app = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db,
      overrides: overrides(llm),
    });
    await app.ready();
    apps.push(app);
    return app;
  }

  it('ships a 120 s ceiling — the number the mock above deliberately does not test', () => {
    // Two minutes is the contract (NFR-10). A stray `120` or `1_200_000` here
    // would leave every mechanism test green: the mocked value is what the
    // batch below actually races against, so nothing else in this repo reads
    // the real one.
    expect(REAL.CASE_TIMEOUT_MS).toBe(120_000);
  });

  it('errors the case that exceeds the ceiling, continues the batch, and aggregates only the completed cases', async () => {
    // The hung case is the SECOND of three, on purpose: a trailing bad case
    // cannot demonstrate that the batch carried on, and a leading one cannot
    // demonstrate that it resumed. `listCases` orders by name.
    const llm = new HangingLLM(2);
    const app = await appWith(llm);
    const service = new EvalService(app.container);

    const [agent] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        name: `Ceiling Agent ${Math.random()}`,
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        systemPrompt: 'You are a reviewer.',
        version: 1,
      })
      .returning();

    for (const name of ['a-fast', 'b-hangs', 'c-fast']) {
      await db.insert(t.evalCases).values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agent!.id,
        name,
        inputDiff: ALPHA_DIFF,
        expectedOutput: [{ file: 'src/alpha.ts', start_line: 2, end_line: 2, kind: 'finding' }],
        expectation: 'must_find',
      });
    }

    const batch = await service.runBatch(workspaceId, agent!.id);

    const runs = await db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.batchId, batch.id))
      .orderBy(asc(t.evalRuns.ranAt));

    // ---- the case ends `errored`, and the distinction is load-bearing ------
    // `failed` says "the agent answered and the answer was wrong" — a real
    // measurement that belongs in the denominators. `errored` says "there is no
    // answer to score". `pass: false` is true of both, so the STATUS is the
    // only thing carrying it.
    expect(runs.map((r) => r.status)).toEqual(['passed', 'errored', 'passed']);
    expect(runs[1]!.status).not.toBe('failed');
    expect(runs[1]!.pass).toBe(false);
    // Empty, not zero: a 0 here would enter the averages as a real bad score.
    expect(runs[1]!.recall).toBeNull();
    expect(runs[1]!.precision).toBeNull();
    expect(runs[1]!.citationAccuracy).toBeNull();
    expect(runs[1]!.costUsd).toBeNull();

    // ---- it was the CEILING that ended it, not an instant provider error ---
    expect(JSON.stringify(runs[1]!.actualOutput)).toContain('ceiling');
    // Timer granularity only ever overshoots; the margin is for `Date.now()`
    // resolution, not for a case that gave up early.
    expect(runs[1]!.durationMs).toBeGreaterThanOrEqual(TEST_CEILING_MS - 50);
    // And the service really aborted its signal — the half a `Promise.race`
    // alone does not give you, and the half a provider needs in order to stop
    // generating (and stop billing).
    expect(llm.abortObserved).toBe(true);

    // ---- the batch CONTINUED ---------------------------------------------
    // Three cases attempted, three provider calls, three run rows: the hung
    // case cost its own slot and nothing else.
    expect(llm.calls).toBe(3);
    expect(runs).toHaveLength(3);
    expect(batch.cases_total).toBe(3);

    // ---- the aggregates cover only the completed cases (AC-42) ------------
    expect(batch.cases_completed).toBe(2);
    // 2 matched / 2 expected across the two that answered. Counting the hung
    // case as a miss would read 0.667 and quietly blame the agent for a
    // provider that went silent.
    expect(batch.recall).toBeCloseTo(1, 10);
    expect(batch.precision).toBeCloseTo(1, 10);
    expect(batch.citation_accuracy).toBeCloseTo(1, 10);
    // Two billed calls, not three.
    expect(batch.cost_usd).toBeCloseTo(0.002, 10);
    // `partial` is how a reader knows the numbers above are over a subset.
    expect(batch.status).toBe('partial');
    expect(batch.partial).toBe(true);
  }, 30_000);
});

/**
 * NFR-4 — three batch requests per minute; the fourth is refused with 429.
 *
 * ## Two obstacles, and what actually happens
 *
 * 1. **`NODE_ENV=test` does not register `@fastify/rate-limit` at all**
 *    (`app.ts:95`), so the route's own `config: { rateLimit: BATCH_RATE_LIMIT }`
 *    is inert under the config every other suite in this folder builds with —
 *    a 429 is unobservable there and always will be. These tests therefore
 *    build the app with `NODE_ENV=development` + `LOG_LEVEL=silent`, which are
 *    the only two things `nodeEnv` and the logger branch on (`config.ts`,
 *    `app.ts:56`). That is the shipped configuration of the limit, not a
 *    special one invented for the test.
 * 2. **An accepted batch DETACHES** (`service.startBatch`), and a detached run
 *    racing teardown is what killed the earlier attempt at this test. So every
 *    request here targets an agent with ZERO eval cases: `prepare` throws
 *    `ValidationError` → 422 before `void this.execute(...)` is ever reached
 *    (AC-112), and no batch row, no model call and no background promise
 *    exists to race anything.
 *
 * The 422s are what make the test conclusive rather than convenient: the
 * limiter's hook runs `onRequest`, ahead of validation and the handler, so a
 * request the handler REFUSES still consumes its token. Requests 1–3 answering
 * 422 proves the handler ran; request 4 answering 429 proves the limiter
 * counted those three anyway. Were the limit applied after the handler, the
 * fourth would be another 422 and this test would fail rather than pass
 * vacuously.
 */
d('NFR-4 — the batch rate limit', () => {
  let pg: PgFixture;
  let db: PgFixture['handle']['db'];
  let workspaceId: string;
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;
    workspaceId = (await seed(db)).workspaceId;
  }, 180_000);

  afterAll(async () => {
    for (const app of apps) await app.close();
    await pg?.stop();
  });

  /**
   * A FRESH app per test. `@fastify/rate-limit` keeps its counters in an
   * in-memory store owned by the plugin instance, so a shared app would carry
   * an exhausted bucket into the next test and every later assertion would be
   * reading the previous test's leftovers.
   */
  async function limitedApp() {
    const app = await buildApp({
      config: loadConfig({
        ...process.env,
        NODE_ENV: 'development',
        LOG_LEVEL: 'silent',
      } as NodeJS.ProcessEnv),
      db,
      overrides: overrides(new MockLLMProvider('openai', { structured: ALPHA_FINDING })),
    });
    await app.ready();
    apps.push(app);
    return app;
  }

  async function agentWithNoCases() {
    const [agent] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        name: `Limited Agent ${Math.random()}`,
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        systemPrompt: 'You are a reviewer.',
      })
      .returning();
    return agent!;
  }

  const post = (app: Awaited<ReturnType<typeof buildApp>>, id: string) =>
    app.inject({ method: 'POST', url: `/agents/${id}/eval-batches` });

  it('refuses the FOURTH batch request in a minute with 429', async () => {
    const app = await limitedApp();
    const agent = await agentWithNoCases();

    const first = await post(app, agent.id);
    const second = await post(app, agent.id);
    const third = await post(app, agent.id);
    const fourth = await post(app, agent.id);

    // 1–3 reached the handler and were refused on their own merits (AC-112).
    expect([first.statusCode, second.statusCode, third.statusCode]).toEqual([422, 422, 422]);
    // 4 never reached it.
    expect(fourth.statusCode).toBe(429);

    // The 429 is the LIMITER's, not another shape of the eval refusal — the
    // difference between "the limit fired" and "the handler said no again".
    const body = JSON.stringify(fourth.json());
    expect(body).toMatch(/rate limit/i);
    expect(body).not.toContain('eval cases');

    // The window advertised on the wire is the ROUTE's 3, not the global 120.
    // Drop the per-route `config` and this is the assertion that notices: the
    // requests would all pass and the header would read 120.
    expect(Number(fourth.headers['x-ratelimit-limit'])).toBe(REAL.BATCH_RATE_LIMIT.max);
    expect(fourth.headers['retry-after']).toBeDefined();

    // Nothing detached and nothing was billed: no batch row exists for any of
    // the four clicks, so there is no background run racing this test's
    // teardown — which is why this is the request the limiter can be measured
    // on at all.
    const batches = await db
      .select()
      .from(t.evalRunBatches)
      .where(eq(t.evalRunBatches.agentId, agent.id));
    expect(batches).toEqual([]);
  });

  it('leaves the unrated reads on the same path alone', async () => {
    const app = await limitedApp();
    const agent = await agentWithNoCases();

    // `GET /agents/:id/eval-batches` is the same URL as the POST and carries no
    // per-route limit, because it is a workspace-scoped read with no model call
    // behind it. Four of them in a row still answer 200 — the tightest limit in
    // this API is on the METHOD that spends money, not on the path.
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-batches` });
      expect(res.statusCode).toBe(200);
      // The counterpart to the header assertion above, and what makes that one
      // conclusive: this route is governed by the LOOSE global bucket, so it
      // advertises a far larger allowance. Delete the POST's per-route `config`
      // and its header would read this number instead of 3.
      expect(Number(res.headers['x-ratelimit-limit'])).toBeGreaterThan(REAL.BATCH_RATE_LIMIT.max);
    }
  });
});

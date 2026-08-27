import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { EvalService } from '../src/modules/evals/service.js';
import { EvalRepository } from '../src/modules/evals/repository.js';
import * as t from '../src/db/schema.js';
import {
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockSecretsProvider,
  MockSourceReader,
} from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals-tenancy] Docker not available — skipping integration tests.');
}

/**
 * L06 / SPEC-08 — AC-28: another workspace's eval data is indistinguishable
 * from data that does not exist.
 *
 * ## Why this criterion gets a whole file
 *
 * `eval_runs` has NO `workspace_id` column. It hangs off `eval_cases` and off
 * `eval_run_batches`, so tenancy on every run-shaped read is re-established
 * PURELY by a join predicate in `modules/evals/repository.ts`. Nothing in the
 * database stops a caller who guesses a batch id from reading another tenant's
 * rows: a bare `where(eq(evalRuns.batchId, id))` returns them and the request
 * succeeds with a 200.
 *
 * That makes a missing predicate a silent cross-tenant read with no other
 * symptom — no error, no log line, no wrong-looking number. A single-workspace
 * fixture would pass whether the predicates were there or not, which is exactly
 * the vacuous green this file exists to avoid. So there are TWO workspaces
 * throughout, each read is attempted from the wrong one, and each is paired with
 * a positive control from the right one so that "empty" cannot be mistaken for
 * "there was nothing to find".
 *
 * The four joins under test are named individually below, because a missing
 * predicate on any ONE of them is the whole bug.
 *
 * FILE NAME IS LOAD-BEARING: `*.it.test.ts` is how the CI suite split finds the
 * Docker-requiring tests.
 */

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = [
  'diff --git a/src/tenant.ts b/src/tenant.ts',
  '--- a/src/tenant.ts',
  '+++ b/src/tenant.ts',
  '@@ -0,0 +1,3 @@',
  '+const a = 1;',
  '+const secret = "sk_live_rival";',
  '+const c = 3;',
].join('\n');

const FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Secret in source.',
  score: 42,
  findings: [
    {
      id: 'f-1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded secret',
      file: 'src/tenant.ts',
      start_line: 2,
      end_line: 2,
      rationale: 'A live key is committed.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

d('eval reads are workspace-scoped (AC-28)', () => {
  let pg: PgFixture;
  let db: PgFixture['handle']['db'];
  let app: Awaited<ReturnType<typeof buildApp>>;
  let service: EvalService;
  let repo: EvalRepository;

  /** The DEFAULT workspace — every HTTP request resolves here. */
  let wsHome: string;
  /** A genuine second tenant. Its rows are reachable BY ID and must still 404. */
  let wsRival: string;

  let rivalAgentId: string;
  let rivalBatchId: string;
  let rivalCaseId: string;
  let rivalFindingId: string;

  let homeAgentId: string;
  let homeBatchId: string;

  /** Build an agent + one case + one finished batch + one run row, in `ws`. */
  async function tenantFixture(ws: string, label: string) {
    const [agent] = await db
      .insert(t.agents)
      .values({
        workspaceId: ws,
        name: `${label} Agent`,
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        systemPrompt: `${label} prompt`,
      })
      .returning();

    const [repoRow] = await db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: label, name: 'api', fullName: `${label}/api` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repoRow!.id,
        number: 1,
        title: `${label} PR`,
        author: 'nobody',
        branch: 'main',
        base: 'main',
        headSha: `sha-${label}`,
        status: 'open',
      })
      .returning();
    await db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/tenant.ts',
      additions: 3,
      deletions: 0,
      patch: '@@ -0,0 +1,3 @@\n+const a = 1;\n+const secret = "sk_live_rival";\n+const c = 3;',
    });
    const [review] = await db
      .insert(t.reviews)
      .values({ workspaceId: ws, prId: pr!.id, kind: 'review', agentId: agent!.id, score: 40 })
      .returning();
    const [finding] = await db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/tenant.ts',
        startLine: 2,
        endLine: 2,
        severity: 'CRITICAL',
        category: 'security',
        title: `${label} secret`,
        rationale: 'A live key is committed.',
        confidence: 0.95,
        acceptedAt: new Date('2026-08-21T10:20:00.000Z'),
      })
      .returning();

    const [evalCase] = await db
      .insert(t.evalCases)
      .values({
        workspaceId: ws,
        ownerKind: 'agent',
        ownerId: agent!.id,
        name: `${label} case`,
        inputDiff: DIFF,
        expectedOutput: [{ file: 'src/tenant.ts', start_line: 2, end_line: 2, kind: 'finding' }],
        expectation: 'must_find',
      })
      .returning();

    // A real batch, run through the service, so the run rows are the ones the
    // production path writes rather than hand-inserted approximations.
    const batch = await new EvalService(app.container).runBatch(ws, agent!.id);

    return {
      agentId: agent!.id,
      batchId: batch.id,
      caseId: evalCase!.id,
      findingId: finding!.id,
    };
  }

  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;
    const seeded = await seed(db);
    wsHome = seeded.workspaceId;

    const [rival] = await db.insert(t.workspaces).values({ name: 'rival-tenant' }).returning();
    wsRival = rival!.id;

    app = await buildApp({
      config: config(),
      db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        sourceReader: new MockSourceReader({}),
        llm: { openrouter: new MockLLMProvider('openai', { structured: FIXTURE }) },
      },
    });
    await app.ready();
    service = new EvalService(app.container);
    repo = new EvalRepository(db);

    const home = await tenantFixture(wsHome, 'home');
    homeAgentId = home.agentId;
    homeBatchId = home.batchId;

    const rivalFx = await tenantFixture(wsRival, 'rival');
    rivalAgentId = rivalFx.agentId;
    rivalBatchId = rivalFx.batchId;
    rivalCaseId = rivalFx.caseId;
    rivalFindingId = rivalFx.findingId;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('has a fixture that is genuinely two tenants, not one', async () => {
    // The control for every assertion below. If the rival's rows did not exist,
    // or both fixtures landed in one workspace, every "returns nothing" below
    // would pass for the wrong reason.
    expect(wsRival).not.toBe(wsHome);

    const [rivalBatch] = await db
      .select()
      .from(t.evalRunBatches)
      .where(eq(t.evalRunBatches.id, rivalBatchId));
    expect(rivalBatch!.workspaceId).toBe(wsRival);

    const rivalRuns = await db.select().from(t.evalRuns).where(eq(t.evalRuns.batchId, rivalBatchId));
    expect(rivalRuns.length).toBeGreaterThan(0);
  });

  it('404s another workspace’s batch, over HTTP, by id', async () => {
    // Requests always resolve to the DEFAULT workspace, so this id is reachable
    // and must still come back as if it were not.
    const res = await app.inject({ method: 'GET', url: `/eval-batches/${rivalBatchId}` });

    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('rival prompt');
    // A prompt snapshot is a whole system prompt: a leak here hands another
    // tenant's agent design over verbatim.
    expect(res.body).not.toContain(rivalAgentId);
  });

  it('404s another workspace’s batch RUNS, over HTTP, by id', async () => {
    const res = await app.inject({ method: 'GET', url: `/eval-batches/${rivalBatchId}/runs` });

    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('rival case');
    expect(res.body).not.toContain('sk_live_rival');
  });

  it('404s another workspace’s DASHBOARD, over HTTP, by agent id', async () => {
    const res = await app.inject({ method: 'GET', url: `/agents/${rivalAgentId}/eval-dashboard` });

    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('rival case');
  });

  it('404s another workspace’s case list and case mutations', async () => {
    const list = await app.inject({ method: 'GET', url: `/agents/${rivalAgentId}/eval-cases` });
    // A list read of a foreign owner returns an EMPTY set rather than 404 —
    // `listCases` is scoped by workspace, so the rival's case is not selectable.
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([]);

    const del = await app.inject({ method: 'DELETE', url: `/eval-cases/${rivalCaseId}` });
    expect(del.statusCode).toBe(404);

    // …and the case is still there. A "404" that deleted the row anyway would
    // be the worse half of the same bug.
    const [still] = await db.select().from(t.evalCases).where(eq(t.evalCases.id, rivalCaseId));
    expect(still).toBeDefined();
  });

  it('refuses to seed a case from another workspace’s finding', async () => {
    const res = await app.inject({ method: 'POST', url: `/findings/${rivalFindingId}/eval-case` });

    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('rival secret');
  });

  describe('the four repository joins AC-28 rests on', () => {
    it('findingWithPatch scopes through reviews.workspace_id', async () => {
      expect(await repo.findingWithPatch(wsHome, rivalFindingId)).toBeUndefined();
      // Positive control from the rival's own workspace: the row IS findable,
      // so `undefined` above is the predicate and not a missing row.
      expect(await repo.findingWithPatch(wsRival, rivalFindingId)).toBeDefined();
    });

    it('runsForBatch joins to eval_run_batches for its workspace predicate', async () => {
      expect(await repo.runsForBatch(wsHome, rivalBatchId)).toEqual([]);
      expect((await repo.runsForBatch(wsRival, rivalBatchId)).length).toBeGreaterThan(0);
    });

    it('recentRuns joins to eval_run_batches for its workspace predicate', async () => {
      expect(await repo.recentRuns(wsHome, rivalAgentId, 50)).toEqual([]);
      expect((await repo.recentRuns(wsRival, rivalAgentId, 50)).length).toBeGreaterThan(0);
    });

    it('passedCountByBatch joins to eval_run_batches for its workspace predicate', async () => {
      const wrong = await repo.passedCountByBatch(wsHome, [rivalBatchId]);
      expect(wrong.size).toBe(0);

      const right = await repo.passedCountByBatch(wsRival, [rivalBatchId]);
      expect(right.get(rivalBatchId)).toBeGreaterThan(0);
      // The count arrives from `count()` as a bigint STRING on postgres-js; a
      // missing `Number()` would make this a string and the comparison a lie.
      expect(typeof right.get(rivalBatchId)).toBe('number');
    });
  });

  it('is symmetric — the rival cannot read HOME’s batch either', async () => {
    // Tenancy that only holds in one direction is not tenancy; the predicate
    // could be a hard-coded default-workspace filter and every test above would
    // still pass.
    await expect(service.getBatch(wsRival, homeBatchId)).rejects.toThrow();
    await expect(service.runsForBatch(wsRival, homeBatchId)).rejects.toThrow();
    await expect(service.dashboard(wsRival, homeAgentId)).rejects.toThrow();

    expect(await repo.runsForBatch(wsRival, homeBatchId)).toEqual([]);
    expect((await repo.runsForBatch(wsHome, homeBatchId)).length).toBeGreaterThan(0);
  });
});

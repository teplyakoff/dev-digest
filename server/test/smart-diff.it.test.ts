import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { ROLE_ORDER } from '../src/modules/smart-diff/constants.js';
import {
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
  MockSourceReader,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[smart-diff] Docker not available — skipping integration tests.');
}

/**
 * `GET /pulls/:id/smart-diff` end to end, over real Postgres.
 *
 * What is under test here is only what the hermetic files CANNOT reach: that the
 * two persisted reads (`pr_files` and the PR's review findings) join through
 * a real database and serialize through the route's compiled response schema,
 * that the tenancy gate holds across a genuine second workspace, and that the
 * call creates no `agent_runs` row.
 *
 * The classifier and the comparator are covered WITHOUT Docker in
 * `smart-diff-classify.test.ts` and `smart-diff-service.test.ts`
 * (`.claude/skills/onion-architecture/SKILL.md` §12) — nothing about grouping or
 * ordering is re-asserted here for its own sake.
 *
 * FILE NAME IS LOAD-BEARING: `*.it.test.ts` is how the CI suite split finds the
 * Docker-requiring tests and keeps them out of the fast lane.
 */

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('GET /pulls/:id/smart-diff', () => {
  let pg: PgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let workspaceId: string;
  let prId: string;
  let foreignPrId: string;

  beforeAll(async () => {
    pg = await startPg();
    const { db } = pg.handle;
    const seeded = await seed(db);
    workspaceId = seeded.workspaceId;

    // A repo + PR built by this test, NOT the seeded `acme/payments-api`:
    // `db.select().from(t.repos)` would hand back the seeded row, because the
    // seed above runs first.
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'smart', fullName: 'acme/smart' })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 512,
        title: 'Scope checkout by tenant',
        author: 'marisa.koch',
        branch: 'fix/tenant-scope',
        base: 'main',
        headSha: 'sha-one',
        additions: 934,
        deletions: 106,
        filesCount: 3,
        status: 'open',
      })
      .returning();
    prId = pr!.id;

    // One file per role, so the response exercises all three groups.
    await db.insert(t.prFiles).values([
      { prId, path: 'src/checkout.ts', additions: 30, deletions: 5, patch: '@@ -1 +1 @@' },
      { prId, path: 'README.md', additions: 4, deletions: 1, patch: null },
      { prId, path: 'pnpm-lock.yaml', additions: 900, deletions: 100, patch: null },
    ]);

    const [review] = await db
      .insert(t.reviews)
      .values({ workspaceId, prId, kind: 'review', score: 72 })
      .returning();
    await db.insert(t.findings).values({
      reviewId: review!.id,
      file: 'src/checkout.ts',
      startLine: 52,
      endLine: 52,
      severity: 'CRITICAL',
      category: 'security',
      title: 'Missing tenant filter',
      rationale: 'the query reads every workspace',
      confidence: 0.9,
    });

    // A run row that exists BEFORE the call, so the "unchanged" assertion below
    // compares 1 against 1 rather than 0 against 0. `pnpm db:seed` writes no
    // `agent_runs` row, so without this the baseline would be empty.
    await db.insert(t.agentRuns).values({ workspaceId, prId, status: 'done', provider: 'openrouter' });

    // A second workspace with its own PR — the tenancy fixture. Requests always
    // resolve to the DEFAULT workspace (`LocalNoAuthProvider`), so this PR is
    // reachable by id and must still 404.
    const [other] = await db.insert(t.workspaces).values({ name: 'other-tenant' }).returning();
    const [otherRepo] = await db
      .insert(t.repos)
      .values({
        workspaceId: other!.id,
        owner: 'rival',
        name: 'secrets',
        fullName: 'rival/secrets',
      })
      .returning();
    const [otherPr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: other!.id,
        repoId: otherRepo!.id,
        number: 1,
        title: 'Another tenant’s PR',
        author: 'nobody',
        branch: 'main',
        base: 'main',
        headSha: 'sha-two',
        status: 'open',
      })
      .returning();
    foreignPrId = otherPr!.id;
    await db.insert(t.prFiles).values({
      prId: foreignPrId,
      path: 'src/their-secret.ts',
      additions: 9,
      deletions: 0,
      patch: null,
    });

    app = await buildApp({
      config: config(),
      db,
      overrides: {
        // Copied WHOLESALE from `intent.it.test.ts`, deliberately, even though
        // Smart Diff uses none of these. An `*.it.test.ts` that omits one
        // override makes live, billed API calls whose only symptom is a timeout
        // — and the empty secrets provider is what turns a forgotten port into a
        // loud `ConfigError` instead of a real request off `server/.env`. See
        // the 2026-08-06 entries in `INSIGHTS.md`; it already happened once.
        secrets: new MockSecretsProvider({}),
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        sourceReader: new MockSourceReader({}),
        llm: { openrouter: new MockLLMProvider('openai') },
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('answers 200 with a body the SmartDiff contract accepts', async () => {
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/smart-diff` });
    expect(res.statusCode).toBe(200);

    // Parsed, not shape-spotted: the route serializes through a compiled schema,
    // so a field the service stopped populating would still be *present* in the
    // JSON. `SmartDiff.parse` is the same contract the client reads.
    const diff = SmartDiff.parse(res.json());

    expect(diff.groups.map((g) => g.role)).toEqual([...ROLE_ORDER]);

    const core = diff.groups.find((g) => g.role === 'core')!.files[0]!;
    expect(core.path).toBe('src/checkout.ts');
    // The join survived the round-trip through two tables.
    expect(core.findings).toHaveLength(1);
    expect(core.findings[0]).toMatchObject({ line: 52, severity: 'CRITICAL', title: 'Missing tenant filter' });
    expect(core.finding_lines).toEqual([52]);
    expect(core.is_large).toBe(false);
    // Nothing populates this without a model call, and this endpoint makes none.
    expect(core.pseudocode_summary).toBeNull();

    const lock = diff.groups.find((g) => g.role === 'boilerplate')!.files[0]!;
    expect(lock.path).toBe('pnpm-lock.yaml');
    expect(lock.is_large).toBe(true);

    expect(diff.split_suggestion.total_lines).toBe(1040);
  });

  it('creates no agent_runs row — the strongest available proof of "no model call"', async () => {
    // `agent_runs` rows are written only by `ReviewRepository.createAgentRun`,
    // reached only from `run-executor.ts`. If Smart Diff ever grew a model call
    // through the normal path, this count would move.
    const countRuns = async () => {
      const rows = await pg.handle.sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM agent_runs`;
      return rows[0]!.count;
    };

    const before = await countRuns();
    expect(before).toBeGreaterThan(0); // the assertion below must not be 0 === 0

    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/smart-diff` });
    expect(res.statusCode).toBe(200);

    expect(await countRuns()).toBe(before);
  });

  it('404s a PR belonging to another workspace', async () => {
    // The PR exists and has files; only the workspace differs. The service's
    // first statement is `getPull(workspaceId, prId)`, and this is what proves
    // the request never reads past it.
    const res = await app.inject({ method: 'GET', url: `/pulls/${foreignPrId}/smart-diff` });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('their-secret');
  });

  it('404s an unknown PR id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/pulls/00000000-0000-0000-0000-000000000000/smart-diff',
    });
    expect(res.statusCode).toBe(404);
  });
});

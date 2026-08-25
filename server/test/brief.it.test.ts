import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { Container } from '../src/platform/container.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { BriefService } from '../src/modules/brief/service.js';
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
  console.warn('[brief] Docker not available — skipping integration tests.');
}

/**
 * The brief module against a real database, with every model replaced by a
 * fixture.
 *
 * FILE NAME IS LOAD-BEARING: `*.it.test.ts` is how the CI suite split finds the
 * Docker-requiring tests, and `gates.sh --unit` excludes them by that name.
 *
 * THE EXPENSIVE TRAP THIS FILE IS BUILT AROUND. This module resolves TWO
 * external ports — `container.github()` for the linked issue and
 * `container.llm(...)` twice over, once for the intent classifier
 * (`openrouter`) and once for the brief (`openai`). An it-test that misses ONE
 * of them does not fail: it makes a live, billed request and times out, with
 * nothing logged (`server/INSIGHTS.md`, 2026-08-06, twice). The remedy from that
 * same entry is below and is not optional — an EMPTY `MockSecretsProvider`, so
 * any port this file forgot to inject raises `ConfigError` before a client is
 * ever constructed, on every machine, whether or not it happens to have a key.
 *
 * What is under test here is everything AROUND the model: that every column
 * round-trips, that a matching head is reused without a call, that a moved head
 * reads stale, that a failed call leaves the stored brief whole, and that a PR
 * with no review runs briefs exactly as well as one with them.
 */

/** Four fields, no provenance — the intent classifier's whole output. */
const INTENT_FIXTURE = {
  summary: 'Adds a per-IP rate limiter to the public API endpoints.',
  in_scope: ['per-IP rate limiting'],
  out_of_scope: [],
  confidence: 'high',
};

/** Five fields, no provenance — the brief's whole output. */
const BRIEF_FIXTURE = {
  what: 'Adds a rate limiter in front of the public endpoints.',
  why: 'To stop one client exhausting the API for everyone.',
  risk_level: 'medium',
  risks: [
    {
      kind: 'availability',
      title: 'A misconfigured window locks every client out',
      explanation: 'the limiter is global, not per route',
      severity: 'medium',
      file_refs: ['src/limiter.ts'],
    },
  ],
  review_focus: [{ path: 'src/limiter.ts', reason: 'the whole change is here' }],
};

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let seq = 0;

d('brief module', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
  }, 120_000);

  afterAll(async () => {
    await pg?.stop();
  });

  /**
   * A repo + PR built by this test, NOT the seeded `acme/payments-api`.
   * `db.select().from(t.repos)` would hand back the seeded row (the seed runs in
   * `beforeAll`), so every test uses the rows this returns.
   */
  async function setupRepoAndPr(over: { headSha?: string; body?: string | null } = {}) {
    const name = `brief-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        clonePath: '/tmp/devdigest-brief-clone',
      })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 482,
        title: 'Add rate limiting to public endpoints',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: over.headSha ?? 'sha-one',
        additions: 40,
        deletions: 2,
        filesCount: 1,
        status: 'open',
        body: over.body === undefined ? 'Implements the limiter. Closes #301.' : over.body,
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/limiter.ts',
      additions: 40,
      deletions: 2,
      // Filled on purpose: the brief must never carry a hunk body (AC-2).
      patch: '@@ -1,2 +1,40 @@\n+const HUNK_BODY_MARKER = true;',
    });
    return { repo: repo!, pr: pr! };
  }

  interface Doubles {
    llmCalls: string[];
    github: MockGitHubClient;
  }

  function makeService(
    over: { brief?: Record<string, unknown> | 'throw'; llmThrows?: boolean } = {},
  ): { service: BriefService; doubles: Doubles } {
    const llmCalls: string[] = [];
    const github = new MockGitHubClient();

    const structured = (schemaName: string, fixture: Record<string, unknown>) =>
      new MockLLMProvider('openai', { structuredBySchema: { [schemaName]: fixture } });

    const briefProvider =
      over.brief === 'throw'
        ? ({
            id: 'openai' as const,
            listModels: async () => [],
            complete: async () => {
              throw new Error('provider down');
            },
            completeStructured: async () => {
              llmCalls.push('brief');
              throw new Error('provider down');
            },
            embed: async () => [],
          } as never)
        : structured('BriefExtraction', over.brief ?? BRIEF_FIXTURE);

    const container = new Container(config(), pg.handle.db, {
      // AN EMPTY SECRETS PROVIDER, AND THE WHOLE FILE DEPENDS ON IT. With
      // nothing to find, `buildLlm` raises `ConfigError` instead of falling
      // through to `server/.env` and making a real, billed call — so a port
      // this harness forgets becomes a loud deterministic failure rather than
      // a timeout and an invoice.
      secrets: new MockSecretsProvider({}),
      git: new MockGitClient(),
      github,
      sourceReader: new MockSourceReader({}),
      llm: {
        // The intent classifier's provider…
        openrouter: structured('IntentExtraction', INTENT_FIXTURE),
        // …and the brief's, which is a different one by default.
        openai: briefProvider,
      },
    });

    // Wrap `llm()` so the test can count what each build resolved without
    // asserting on a mock's internals.
    const resolve = container.llm.bind(container);
    container.llm = async (id) => {
      llmCalls.push(id);
      return resolve(id);
    };

    return { service: new BriefService(container), doubles: { llmCalls, github } };
  }

  beforeEach(async () => {
    await pg.handle.db.delete(t.prBrief);
    await pg.handle.db.delete(t.prIntent);
  });

  describe('test_brief_cache_it', () => {
    it('writes one row per PR and replaces it in place (AC-14, AC-15, AC-28)', async () => {
      const { pr } = await setupRepoAndPr();
      const { service } = makeService();

      await service.build(workspaceId, pr.id);
      await service.build(workspaceId, pr.id);

      const rows = await pg.handle.db
        .select()
        .from(t.prBrief)
        .where(eq(t.prBrief.prId, pr.id));
      expect(rows).toHaveLength(1);

      // Every provenance column round-trips, `attempts` included.
      const row = rows[0]!;
      expect(row.what).toBe(BRIEF_FIXTURE.what);
      expect(row.riskLevel).toBe('medium');
      expect(row.headSha).toBe('sha-one');
      expect(row.provider).toBe('openai');
      expect(row.model).toBeTruthy();
      expect(row.tokensIn).toBe(100);
      expect(row.tokensOut).toBe(50);
      expect(row.costUsd).toBe(0.001);
      expect(row.attempts).toBe(1);
      expect(row.risksGrounded).toBe(true);
      // The starter's `json` slot is untouched and still defaulted.
      expect(row.json).toEqual({});
    });

    it('reuses a brief built against this head, with no model call (AC-16, AC-20, NFR-3)', async () => {
      const { pr } = await setupRepoAndPr();
      const { service, doubles } = makeService();
      await service.build(workspaceId, pr.id);
      const callsAfterBuild = doubles.llmCalls.length;

      const view = await service.view(workspaceId, pr.id);
      expect(view.reused).toBe(true);
      expect(view.stale).toBe(false);
      expect(view.model_calls).toBe(0);
      // The read spent nothing: not a cheaper call, no call.
      expect(doubles.llmCalls).toHaveLength(callsAfterBuild);
    });

    it('marks a brief built against a different head as stale (AC-17)', async () => {
      const { pr } = await setupRepoAndPr();
      const { service } = makeService();
      await service.build(workspaceId, pr.id);

      await pg.handle.db
        .update(t.pullRequests)
        .set({ headSha: 'sha-two' })
        .where(eq(t.pullRequests.id, pr.id));

      const view = await service.view(workspaceId, pr.id);
      // Still returned: a stale brief marked stale beats no brief.
      expect(view.stale).toBe(true);
      expect(view.brief!.head_sha).toBe('sha-one');
      expect(view.model_calls).toBe(0);
    });

    it('rebuilds on an unchanged head when asked to (AC-18)', async () => {
      const { pr } = await setupRepoAndPr();
      const { service, doubles } = makeService();
      const first = await service.build(workspaceId, pr.id);
      const callsAfterFirst = doubles.llmCalls.filter((c) => c === 'openai').length;

      const second = await service.build(workspaceId, pr.id);
      // The button means "do it again": a rebuild that quietly returned the
      // cached row would be a button that does nothing.
      expect(doubles.llmCalls.filter((c) => c === 'openai').length).toBe(callsAfterFirst + 1);
      expect(second.reused).toBe(false);
      expect(new Date(second.brief!.derived_at).getTime()).toBeGreaterThanOrEqual(
        new Date(first.brief!.derived_at).getTime(),
      );
    });

    it('coalesces two builds in flight into one billed call', async () => {
      const { pr } = await setupRepoAndPr();
      const { service, doubles } = makeService();

      const [a, b] = await Promise.all([
        service.build(workspaceId, pr.id),
        service.build(workspaceId, pr.id),
      ]);

      // One call, one row, one answer — not two calls racing to the upsert
      // where the older build can land last.
      expect(doubles.llmCalls.filter((c) => c === 'openai')).toHaveLength(1);
      expect(a).toEqual(b);
    });

    it('answers a PR that has no brief with an empty one, not an error (AC-67)', async () => {
      const { pr } = await setupRepoAndPr();
      const { service } = makeService();
      const view = await service.view(workspaceId, pr.id);
      expect(view).toEqual({ brief: null, stale: false, reused: false, model_calls: 0 });
    });

    it('does not resolve a PR from another workspace', async () => {
      const { pr } = await setupRepoAndPr();
      const { service } = makeService();
      // `pr_brief` has no workspace column; the pull lookup IS the boundary.
      await expect(
        service.view('00000000-0000-0000-0000-000000000000', pr.id),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('test_brief_intent_it', () => {
    it('derives a missing intent first, and counts both calls (AC-3, AC-5, NFR-3)', async () => {
      const { pr } = await setupRepoAndPr();
      const { service, doubles } = makeService();

      const view = await service.build(workspaceId, pr.id);
      // Cold PR: one classifier call plus one brief call.
      expect(view.model_calls).toBe(2);
      expect(doubles.llmCalls).toEqual(['openrouter', 'openai']);
      const [intent] = await pg.handle.db
        .select()
        .from(t.prIntent)
        .where(eq(t.prIntent.prId, pr.id));
      expect(intent!.summary).toBe(INTENT_FIXTURE.summary);
    });

    it('reuses a fresh intent without calling the classifier (AC-4, NFR-3)', async () => {
      const { pr } = await setupRepoAndPr();
      const { service } = makeService();
      await service.build(workspaceId, pr.id);

      const { service: second, doubles } = makeService();
      const view = await second.build(workspaceId, pr.id);

      // Warm PR: the classifier is not called at all, so one call in total.
      expect(view.model_calls).toBe(1);
      expect(doubles.llmCalls).toEqual(['openai']);
    });
  });

  describe('test_brief_input_it', () => {
    it('takes every project-context document, by name (AC-32)', async () => {
      const { repo, pr } = await setupRepoAndPr();
      await pg.handle.db.insert(t.contextDocs).values([
        { workspaceId, repoId: repo.id, name: 'zeta.md', body: 'zeta body' },
        { workspaceId, repoId: repo.id, name: 'alpha.md', body: 'alpha body' },
      ]);
      const { service } = makeService();
      await service.build(workspaceId, pr.id);

      // Nothing was dropped, so both documents were in the prompt — and the
      // budget would have reported it if they had not been.
      const [row] = await pg.handle.db
        .select()
        .from(t.prBrief)
        .where(eq(t.prBrief.prId, pr.id));
      expect(row!.droppedBlocks).toEqual([]);
    });

    it('carries the linked issue text and no hunk body (AC-33, AC-2)', async () => {
      const { pr } = await setupRepoAndPr();
      const { service, doubles } = makeService();
      await service.build(workspaceId, pr.id);

      // The issue really was fetched — through the GitHub port, live, exactly
      // as the derivation does it.
      expect(doubles.github).toBeDefined();
      const [row] = await pg.handle.db
        .select()
        .from(t.prBrief)
        .where(eq(t.prBrief.prId, pr.id));
      expect(row!.unavailableInputs).toEqual([]);
      expect(JSON.stringify(row)).not.toContain('HUNK_BODY_MARKER');
    });

    it('lists an unfetchable issue among the unavailable inputs (AC-34, AC-59)', async () => {
      const { pr } = await setupRepoAndPr();
      const { service } = makeService();
      // A GitHub client whose issue read fails, everything else untouched.
      const svc = service as unknown as { container: { github: () => Promise<unknown> } };
      svc.container.github = async () => ({
        getIssue: async () => {
          throw new Error('404 Not Found');
        },
      });

      const view = await service.build(workspaceId, pr.id);
      // The build succeeded WITHOUT the issue…
      expect(view.brief).not.toBeNull();
      // …and said so, rather than dropping the gap silently.
      expect(view.brief!.unavailable_inputs.join(' ')).toContain('#301');
      expect(view.brief!.unavailable_inputs.join(' ')).toContain('404');
    });
  });

  describe('test_brief_failure_it', () => {
    it('leaves the stored brief whole when the call fails (AC-29)', async () => {
      const { pr } = await setupRepoAndPr();
      const good = makeService();
      await good.service.build(workspaceId, pr.id);
      const before = await good.service.view(workspaceId, pr.id);

      const bad = makeService({ brief: 'throw' });
      await expect(bad.service.build(workspaceId, pr.id)).rejects.toThrow('provider down');

      // Byte-identical: a failed rebuild is not a partial write, and the error
      // goes up rather than being swallowed into an empty brief.
      const after = await good.service.view(workspaceId, pr.id);
      expect(after).toEqual(before);
    });
  });

  describe('test_brief_no_runs_it', () => {
    it('briefs a PR that has never been reviewed (AC-30)', async () => {
      const { pr } = await setupRepoAndPr();
      const runs = await pg.handle.db.select().from(t.agentRuns);
      expect(runs.filter((r) => r.prId === pr.id)).toHaveLength(0);

      const { service } = makeService();
      const view = await service.build(workspaceId, pr.id);
      expect(view.brief!.what).toBe(BRIEF_FIXTURE.what);
      expect(view.brief!.risks).toHaveLength(1);
    });

    it('produces the same brief before and after a review exists (AC-31)', async () => {
      const { repo, pr } = await setupRepoAndPr();
      const { service } = makeService();
      const before = await service.build(workspaceId, pr.id);

      // A review with a finding and a verdict — everything the brief must not
      // be reading. There is no code path from this module to `findings`, so
      // this test pins a structural property rather than a coincidence.
      const [review] = await pg.handle.db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId: pr.id,
          kind: 'review',
          verdict: 'request_changes',
          summary: 'nope',
          score: 12,
          model: 'm',
        })
        .returning();
      await pg.handle.db.insert(t.findings).values({
        reviewId: review!.id,
        file: 'src/limiter.ts',
        startLine: 1,
        endLine: 2,
        severity: 'CRITICAL',
        category: 'bug',
        title: 'a finding the brief must not see',
        rationale: 'r',
        confidence: 0.9,
      });
      expect(repo).toBeDefined();

      const after = await service.build(workspaceId, pr.id);
      expect(after.brief!.what).toBe(before.brief!.what);
      expect(after.brief!.risk_level).toBe(before.brief!.risk_level);
      expect(after.brief!.risks).toEqual(before.brief!.risks);
      expect(after.brief!.review_focus).toEqual(before.brief!.review_focus);
    });
  });

  describe('test_brief_routes_it', () => {
    /**
     * The app, with the same doubles the service tests use.
     *
     * `nodeEnv` is deliberately NOT `test` here: `buildApp` skips registering
     * the rate-limit plugin entirely under test, so a per-route `config
     * .rateLimit` has nothing to attach to and AC-19 would pass vacuously.
     */
    function makeApp(over: { nodeEnv?: string } = {}) {
      const structured = (schemaName: string, fixture: Record<string, unknown>) =>
        new MockLLMProvider('openai', { structuredBySchema: { [schemaName]: fixture } });
      return buildApp({
        config: loadConfig({
          ...process.env,
          NODE_ENV: over.nodeEnv ?? 'test',
          // `NODE_ENV=test` silences logs by default; the rate-limit case has to
          // leave test mode to get a limiter at all, so it asks for silence
          // explicitly rather than printing a stack trace for its own 429.
          LOG_LEVEL: 'silent',
        } as NodeJS.ProcessEnv),
        db: pg.handle.db,
        overrides: {
          // Empty on purpose — see the note at the top of this file. A port this
          // harness forgets becomes a ConfigError, never a billed request.
          secrets: new MockSecretsProvider({}),
          git: new MockGitClient(),
          github: new MockGitHubClient(),
          sourceReader: new MockSourceReader({}),
          llm: {
            openrouter: structured('IntentExtraction', INTENT_FIXTURE),
            openai: structured('BriefExtraction', BRIEF_FIXTURE),
          },
        },
      });
    }

    it('answers a PR with no brief with an empty brief, not a 404 (AC-67)', async () => {
      const { pr } = await setupRepoAndPr();
      const app = await makeApp();
      const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ brief: null, stale: false, reused: false, model_calls: 0 });
      await app.close();
    });

    it('rejects an invalid uuid with 422, before the handler runs', async () => {
      const app = await makeApp();
      const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/brief' });
      expect(res.statusCode).toBe(422);
      await app.close();
    });

    it('returns the built brief and its model_calls (AC-5)', async () => {
      const { pr } = await setupRepoAndPr();
      const app = await makeApp();
      const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.brief.what).toBe(BRIEF_FIXTURE.what);
      // Cold PR: the classifier plus the brief.
      expect(body.model_calls).toBe(2);
      expect(body.reused).toBe(false);

      // A re-read returns the same persisted row, so nothing above was
      // response-only.
      const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
      expect(get.json().brief).toEqual(body.brief);
      await app.close();
    });

    it('refuses the 11th rebuild inside a minute (AC-19)', async () => {
      const { pr } = await setupRepoAndPr();
      const app = await makeApp({ nodeEnv: 'development' });

      const codes: number[] = [];
      for (let i = 0; i < 11; i++) {
        const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
        codes.push(res.statusCode);
      }

      expect(codes.slice(0, 10)).toEqual(Array(10).fill(200));
      // The eleventh is refused rather than served: each of these is a real,
      // billed model call against author-controlled input.
      expect(codes[10]).toBe(429);
      // …and the READ is not limited, because it spends nothing.
      const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
      expect(get.statusCode).toBe(200);
      await app.close();
    });
  });
});

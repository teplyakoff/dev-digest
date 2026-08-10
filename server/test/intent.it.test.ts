import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
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
  console.warn('[intent] Docker not available — skipping integration tests.');
}

/**
 * The intent module end to end, with the model replaced by a fixture.
 *
 * What is under test is everything AROUND the model: that all ten new columns
 * round-trip, that `sources` and `missing_context` are the SERVER's and not the
 * fixture's, that a moved head re-derives while an unmoved one does not, and
 * that a PR in another workspace does not resolve at all.
 *
 * The pure rules — the path denylist, the confidence floor, the caps, the "no
 * change bodies" guarantee — are covered without Docker in
 * `intent-sources.test.ts` and `intent-prompt.test.ts`.
 *
 * FILE NAME IS LOad-BEARING: `*.it.test.ts` is how the CI suite split finds the
 * Docker-requiring tests.
 */

const CLONE = {
  'docs/plans/rate-limits.md': '# Rate limits\n\nCap public endpoints at 100 req/min.\n',
  '.env': 'STRIPE_KEY=sk_live_must_never_be_read\n',
};

/** What the classifier is allowed to return: four fields, no provenance. */
const EXTRACTION = {
  summary: 'Adds a per-IP rate limiter to the public API endpoints.',
  in_scope: ['per-IP rate limiting', 'limiter config'],
  out_of_scope: ['auth rework'],
  confidence: 'high',
};

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let seq = 0;

d('intent module', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  /**
   * A repo + PR built by this test, NOT the seeded `acme/payments-api`.
   * `db.select().from(t.repos)` would hand back the seeded row (the seed runs in
   * `beforeAll`), so every test uses the rows this returns.
   */
  async function setupRepoAndPr(over: { body?: string | null; headSha?: string } = {}) {
    const name = `intent-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        clonePath: '/tmp/devdigest-intent-clone',
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
        additions: 12,
        deletions: 0,
        filesCount: 1,
        status: 'open',
        body:
          over.body === undefined
            ? 'Implements docs/plans/rate-limits.md. Closes #301. Background: https://wiki.internal/x'
            : over.body,
      })
      .returning();
    return { repo: repo!, pr: pr! };
  }

  function makeApp(over: { extraction?: Record<string, unknown> } = {}) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        // An empty secrets provider, so a port this file forgets to inject
        // raises `ConfigError` instead of resolving a real client off
        // `server/.env` and making a live, billed request. See the long note in
        // `reviews.it.test.ts` — that is not hypothetical, it already happened.
        secrets: new MockSecretsProvider({}),
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        sourceReader: new MockSourceReader(CLONE),
        llm: {
          openrouter: new MockLLMProvider('openai', {
            structuredBySchema: { IntentExtraction: over.extraction ?? EXTRACTION },
          }),
        },
      },
    });
  }

  beforeEach(async () => {
    await pg.handle.db.delete(t.prIntent);
  });

  it('GET answers 200 with a null before anything has been derived', async () => {
    const { pr } = await setupRepoAndPr();
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    // A 200 with `{intent: null}`, mirroring ConventionsView's `{scan: null}` —
    // "not derived yet" is a state, not an error the client has to branch on.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ intent: null });
  });

  it('POST derives and round-trips every new column', async () => {
    const { pr } = await setupRepoAndPr();
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });
    expect(res.statusCode).toBe(200);
    const intent = res.json().intent;

    expect(intent.summary).toBe(EXTRACTION.summary);
    expect(intent.in_scope).toEqual(EXTRACTION.in_scope);
    expect(intent.out_of_scope).toEqual(EXTRACTION.out_of_scope);
    expect(intent.head_sha).toBe('sha-one');
    expect(intent.provider).toBe('openrouter');
    expect(intent.model).toBeTruthy();
    expect(intent.derived_at).toBeTruthy();
    expect(intent.tokens_in).toBe(100);
    expect(intent.tokens_out).toBe(50);
    expect(intent.cost_usd).toBe(0.001);

    // A re-read returns the same persisted row, so nothing above was
    // response-only.
    const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(get.json().intent).toEqual(intent);
  });

  it('computes sources and missing_context itself — the fixture supplies neither', async () => {
    const { pr } = await setupRepoAndPr();
    const app = await makeApp();
    const intent = (await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` })).json().intent;

    const byKind = Object.fromEntries(intent.sources.map((s: { kind: string }) => [s.kind, s]));
    expect(byKind.pr_title.status).toBe('used');
    expect(byKind.pr_body.status).toBe('used');
    expect(byKind.linked_issue).toMatchObject({ ref: '#301', status: 'used' });
    expect(byKind.repo_file).toMatchObject({
      ref: 'docs/plans/rate-limits.md',
      status: 'used',
    });
    // Recorded, never fetched.
    expect(byKind.link).toMatchObject({
      ref: 'https://wiki.internal/x',
      status: 'unavailable',
      note: 'external links are not fetched',
    });
    expect(intent.missing_context.some((m: string) => m.includes('wiki.internal'))).toBe(true);

    // An unfetched link is RECORDED but is not a material gap: everything the
    // collector set out to read — the issue and the plan — it read. So a claimed
    // `high` stands, and the scope filter stays armed.
    //
    // This used to assert `medium`, on the rule that ANY `missing_context` entry
    // demotes. That rule made the scope filter dead code on every real PR whose
    // body contains a URL, which is nearly all of them; see the 2026-08-06
    // entries in `INSIGHTS.md`.
    expect(intent.confidence).toBe('high');
  });

  it('refuses a .env named in the body, and says so instead of going quiet', async () => {
    const { pr } = await setupRepoAndPr({ body: 'Config context is in .env — read it.' });
    const app = await makeApp();
    const intent = (await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` })).json().intent;

    expect(intent.sources).toContainEqual({
      kind: 'repo_file',
      ref: '.env',
      status: 'unavailable',
      note: 'not an allowed document path',
    });
    expect(intent.missing_context.some((m: string) => m.includes('.env'))).toBe(true);

    // The secret reached neither the model's prompt nor the persisted row.
    expect(JSON.stringify(intent)).not.toContain('sk_live');
  });

  it('deriveIfStale re-derives when the head moves and reuses it when it has not', async () => {
    const { repo, pr } = await setupRepoAndPr();
    const app = await makeApp();
    const container = app.container;
    const ctx = {
      workspaceId,
      pull: pr,
      repo: {
        owner: repo.owner,
        name: repo.name,
        fullName: repo.fullName,
        clonePath: repo.clonePath,
      },
      diff: await new MockGitClient().diff(),
    };

    const first = await container.intent.deriveIfStale(ctx);
    expect(first.record.head_sha).toBe('sha-one');
    expect(first.reused).toBe(false);

    // Same head → the row is reused, `derived_at` does not move.
    const second = await container.intent.deriveIfStale(ctx);
    expect(second.record.derived_at).toBe(first.record.derived_at);
    // `reused` is what stops the run trace billing this run for a model call it
    // never made — the record still carries the FIRST derivation's tokens and
    // cost, so without this flag every later run double-counts the classifier.
    expect(second.reused).toBe(true);

    // Head moved → a different PR, so a new derivation.
    const moved = { ...ctx, pull: { ...pr, headSha: 'sha-two' } };
    const third = await container.intent.deriveIfStale(moved);
    expect(third.record.head_sha).toBe('sha-two');
    expect(third.record.derived_at).not.toBe(first.record.derived_at);
    expect(third.reused).toBe(false);

    // Still exactly one row: it is an upsert on the PR, not an append.
    const rows = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
    expect(rows).toHaveLength(1);
  });

  it('a PR in another workspace 404s rather than leaking across the tenant', async () => {
    const { pr } = await setupRepoAndPr();
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-${seq++}` })
      .returning();
    // `pr_intent` has no workspace_id of its own, so the PR lookup IS the
    // tenancy boundary — this asserts the service actually goes through it.
    const app = await makeApp();
    const view = await app.container.intent
      .view(other!.id, pr.id)
      .then(() => 'resolved')
      .catch((err: Error) => err.message);
    expect(view).toMatch(/not found/i);
  });

  it('an unknown PR id is a 404', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: '/pulls/00000000-0000-0000-0000-000000000000/intent',
    });
    expect(res.statusCode).toBe(404);
  });

  it('a malformed PR id is rejected at the edge with a 422', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/intent' });
    expect(res.statusCode).toBe(422);
  });
});

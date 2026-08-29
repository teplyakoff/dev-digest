import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { CreateEvalCaseFromFinding, EvalCaseRecord, type LLMProvider } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { EvalService } from '../src/modules/evals/service.js';
import { NO_DIFF_MESSAGE } from '../src/modules/evals/constants.js';
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
  console.warn('[evals-create] Docker not available — skipping integration tests.');
}

/**
 * L06 / SPEC-08 — one decided finding → one eval case, over real Postgres
 * (AC-15…AC-19, AC-22…AC-27, AC-35, AC-100, AC-101).
 *
 * The pure half of this — which direction a decision implies, what
 * `expected_output` looks like, how a stored patch becomes a one-file diff — is
 * asserted WITHOUT Docker in `evals-seedcase.test.ts`. What is only reachable
 * here is what a database and a route add: that the values survive an insert,
 * that the `expectation` CHECK is real, that `ON DELETE SET NULL` behaves as the
 * migration claims, and that each refusal comes back as the right status code
 * with the reason in the body.
 *
 * ## Every adapter is overridden, exhaustively
 *
 * An `*.it.test.ts` that omits ONE port falls through `LocalSecretsProvider` →
 * `process.env` → the real keys in `server/.env`, which vitest loads, and makes
 * live billed calls whose only symptom is a timeout (`server/INSIGHTS.md`,
 * 2026-08-06, twice). The empty `MockSecretsProvider` is the load-bearing one:
 * with nothing to find, a forgotten port raises `ConfigError` before a client is
 * constructed, on every machine, instead of billing on the one machine that
 * happens to hold the key.
 *
 * FILE NAME IS LOAD-BEARING: `*.it.test.ts` is how the CI suite split finds the
 * Docker-requiring tests.
 */

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Nothing on the case-creation path may reach a model. Reaching it is the failure. */
class ThrowingLLM implements LLMProvider {
  readonly id = 'openrouter' as const;
  listModels(): never {
    throw new Error('case creation called listModels — it must cost zero tokens');
  }
  complete(): never {
    throw new Error('case creation called complete — it must cost zero tokens');
  }
  completeStructured(): never {
    throw new Error('case creation called completeStructured — it must cost zero tokens');
  }
  embed(): never {
    throw new Error('case creation called embed — it must cost zero tokens');
  }
}

const PATCH = [
  '@@ -10,3 +10,5 @@',
  '   port: 3000,',
  '+  stripeKey: "sk_live_xxx",',
  '+  redisUrl: process.env.REDIS_URL,',
  '   timeout: 30,',
].join('\n');

d('POST /findings/:id/eval-case', () => {
  let pg: PgFixture;
  let db: PgFixture['handle']['db'];
  let app: Awaited<ReturnType<typeof buildApp>>;
  let service: EvalService;
  let workspaceId: string;
  let agentId: string;
  let acceptedId: string;
  let dismissedId: string;
  let undecidedId: string;
  let noPatchId: string;

  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;
    const seeded = await seed(db);
    workspaceId = seeded.workspaceId;

    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'General Reviewer')));
    agentId = agent!.id;

    // This test's OWN repo and PR: `db.select().from(t.repos)` would hand back
    // the seeded `acme/payments-api`, because `seed()` above ran first
    // (`server/INSIGHTS.md`, 2026-07-28).
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'cases', fullName: 'acme/cases' })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 900,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'sha-cases',
        status: 'open',
      })
      .returning();

    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/config.ts', additions: 2, deletions: 0, patch: PATCH },
      // A file whose patch GitHub truncated away — AC-18's real-world shape.
      { prId: pr!.id, path: 'pnpm-lock.yaml', additions: 900, deletions: 3, patch: null },
    ]);

    // The review carries an agent, which is what gives the resulting case an
    // owner to be run under.
    const [review] = await db
      .insert(t.reviews)
      .values({ workspaceId, prId: pr!.id, kind: 'review', agentId, score: 54 })
      .returning();

    const inserted = await db
      .insert(t.findings)
      .values([
        {
          reviewId: review!.id,
          file: 'src/config.ts',
          startLine: 11,
          endLine: 12,
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key',
          rationale: 'A live Stripe key is committed in source.',
          confidence: 0.95,
          acceptedAt: new Date('2026-08-21T10:20:00.000Z'),
        },
        {
          reviewId: review!.id,
          file: 'src/config.ts',
          startLine: 12,
          endLine: 12,
          severity: 'SUGGESTION',
          category: 'style',
          title: 'Read the Redis URL through a typed accessor',
          rationale: 'Inline env reads hide provenance.',
          confidence: 0.4,
          dismissedAt: new Date('2026-08-21T10:24:00.000Z'),
        },
        {
          reviewId: review!.id,
          file: 'src/config.ts',
          startLine: 11,
          endLine: 11,
          severity: 'WARNING',
          category: 'bug',
          title: 'Nobody has looked at this one yet',
          rationale: 'Undecided on purpose.',
          confidence: 0.5,
        },
        {
          reviewId: review!.id,
          file: 'pnpm-lock.yaml',
          startLine: 4,
          endLine: 4,
          severity: 'SUGGESTION',
          category: 'style',
          title: 'Lockfile churn',
          rationale: 'The file this points at carries no stored patch.',
          confidence: 0.3,
          acceptedAt: new Date('2026-08-21T10:20:00.000Z'),
        },
      ])
      .returning();

    acceptedId = inserted[0]!.id;
    dismissedId = inserted[1]!.id;
    undecidedId = inserted[2]!.id;
    noPatchId = inserted[3]!.id;

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
    service = new EvalService(app.container);
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('turns an ACCEPTED finding into a must_find case carrying its exact location', async () => {
    const res = await app.inject({ method: 'POST', url: `/findings/${acceptedId}/eval-case` });
    expect(res.statusCode).toBe(201);

    // Parsed against the same contract the client reads, not shape-spotted: the
    // route serialises through a compiled schema, so a field the service stopped
    // populating would still be present in the JSON.
    const body = CreateEvalCaseFromFinding.parse(res.json());

    expect(body.case.expectation).toBe('must_find'); // AC-15
    expect(body.case.source_finding_id).toBe(acceptedId); // AC-22
    expect(body.case.owner_kind).toBe('agent');
    expect(body.case.owner_id).toBe(agentId);
    // AC-20 — exactly one expectation, path and range verbatim.
    expect(body.case.expected_output).toEqual([
      { file: 'src/config.ts', start_line: 11, end_line: 12, kind: 'finding' },
    ]);
    // AC-19 — the finding's OWN file and nothing else.
    expect(body.case.input_diff).toContain('diff --git a/src/config.ts b/src/config.ts');
    expect(body.case.input_diff).toContain('stripeKey');
    expect(body.case.input_diff).not.toContain('pnpm-lock.yaml');
    // First case from this finding: nothing existed before it.
    expect(body.existing_cases).toEqual([]);
  });

  it('turns a DISMISSED finding into a must_not_flag case expecting an empty list', async () => {
    const res = await app.inject({ method: 'POST', url: `/findings/${dismissedId}/eval-case` });
    expect(res.statusCode).toBe(201);
    const body = CreateEvalCaseFromFinding.parse(res.json());

    expect(body.case.expectation).toBe('must_not_flag'); // AC-16
    expect(body.case.expected_output).toEqual([]); // AC-21
    expect(body.case.expected_output).not.toBeNull();

    // …and it survived the jsonb round trip as an array, not as `{}` or `null`.
    const [row] = await db
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.id, body.case.id));
    expect(Array.isArray(row!.expectedOutput)).toBe(true);
  });

  it('allows a SECOND case from the same finding and names the ones already there', async () => {
    const res = await app.inject({ method: 'POST', url: `/findings/${acceptedId}/eval-case` });
    expect(res.statusCode).toBe(201); // AC-24 — allowed, not a 409
    const body = CreateEvalCaseFromFinding.parse(res.json());

    // AC-25 — the caller is told about the others rather than blocked. Every
    // listed case really came from this finding.
    expect(body.existing_cases.length).toBeGreaterThanOrEqual(1);
    for (const other of body.existing_cases) {
      expect(other.source_finding_id).toBe(acceptedId);
      expect(other.id).not.toBe(body.case.id);
    }
  });

  it('refuses an UNDECIDED finding with 422 and says why (AC-17)', async () => {
    const res = await app.inject({ method: 'POST', url: `/findings/${undecidedId}/eval-case` });

    expect(res.statusCode).toBe(422);
    // The body carries the reason because it is the string the client toast
    // shows; a bare 422 leaves the user with a button that does nothing.
    expect(res.body).toMatch(/accepted nor dismissed/i);
  });

  it('refuses a finding whose file carries no patch, naming that reason (AC-18, AC-101)', async () => {
    const res = await app.inject({ method: 'POST', url: `/findings/${noPatchId}/eval-case` });

    expect(res.statusCode).toBe(422);
    // The exact message, imported rather than retyped: a case created with an
    // empty diff would pass creation, ground nothing, and pin `recall` at zero
    // forever while the dashboard looked full.
    expect(res.json()).toMatchObject({ error: { message: NO_DIFF_MESSAGE } });
  });

  it('404s an unknown finding id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/findings/00000000-0000-0000-0000-000000000000/eval-case',
    });
    expect(res.statusCode).toBe(404);
  });

  it('keeps the case when its source finding is deleted, and clears the pointer (AC-23, AC-100)', async () => {
    const created = await service.createCaseFromFinding(workspaceId, dismissedId);

    await db.delete(t.findings).where(eq(t.findings.id, dismissedId));

    const [row] = await db.select().from(t.evalCases).where(eq(t.evalCases.id, created.case.id));

    // ON DELETE SET NULL, not CASCADE: the case carries its own diff and its own
    // expectation, so it stays runnable — it merely loses the pointer home. A
    // CASCADE here would silently shrink the regression set every time somebody
    // tidied up a finding.
    expect(row, 'the case was deleted along with its finding').toBeDefined();
    expect(row!.sourceFindingId).toBeNull();
    expect(row!.inputDiff).toContain('stripeKey');
    expect(row!.expectation).toBe('must_not_flag');
  });

  it('rejects a third expectation value at the DATABASE, not merely in Zod (AC-26)', async () => {
    // The CHECK and the `EvalExpectation` enum are one edit in two places. If
    // only the enum is edited, this is where the mismatch shows up — otherwise
    // it shows up as a failing insert in production.
    await expect(
      pg.handle.sql`
        INSERT INTO eval_cases (workspace_id, owner_kind, owner_id, name, expectation)
        VALUES (${workspaceId}::uuid, 'agent', ${agentId}::uuid, 'bad', 'maybe')`,
    ).rejects.toThrow(/eval_cases_expectation_ck|check constraint/i);
  });

  it('refuses a case owned by a skill with 422 (AC-27)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: {
        owner_kind: 'skill',
        owner_id: agentId,
        name: 'skill-owned',
        input_diff: 'diff --git a/x b/x',
        expected_output: [],
        expectation: 'must_find',
      },
    });

    expect(res.statusCode).toBe(422);
    // And nothing was written — a rejected request that still inserts is worse
    // than one that fails outright.
    const rows = await db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.name, 'skill-owned')));
    expect(rows).toEqual([]);
  });

  it('returns the owner’s whole set in ONE response, unpaginated (NFR-14)', async () => {
    const res = await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-cases` });
    expect(res.statusCode).toBe(200);

    const cases = res.json().map((c: unknown) => EvalCaseRecord.parse(c));
    const persisted = await db
      .select()
      .from(t.evalCases)
      .where(
        and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerId, agentId)),
      );

    // Every persisted case, not a page of them, and no envelope to unwrap.
    expect(cases).toHaveLength(persisted.length);
    expect(res.json()).toBeInstanceOf(Array);
  });

  it('builds at least eight cases from the SEEDED decided findings, through the real path (AC-35)', async () => {
    // `eval_cases` is never seeded directly — the demo set has to be reachable
    // by the same one-click route a user clicks, or the eight cases the lesson
    // demonstrates are eight rows nobody's code path can produce.
    //
    // KNOWN RED as of 2026-08-27, and this is the criterion reporting a real
    // defect rather than a flaky test. `src/db/seed.ts` inserts the demo review
    // with NO `agent_id`, and `EvalRepository.findingWithPatch` reads the
    // owner from `reviews.agent_id` — so all twelve decided seeded findings
    // come back 422 "This finding came from a review with no agent attached".
    // Both halves are individually reasonable; the seam between them is not.
    // The fix belongs in the seed (T-D), not here: the review is inserted at
    // `src/db/seed.ts:159` while the built-in agents are only created at `:244`,
    // so it needs the agent to exist first (or a later `UPDATE`) — it is not a
    // one-line reorder. Nothing in this test is changed to make it pass.
    const seededFindings = await db
      .select({ finding: t.findings })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .innerJoin(t.pullRequests, eq(t.reviews.prId, t.pullRequests.id))
      .innerJoin(t.repos, eq(t.pullRequests.repoId, t.repos.id))
      .where(eq(t.repos.fullName, 'acme/payments-api'));

    const decided = seededFindings
      .map((r) => r.finding)
      .filter((f) => f.acceptedAt !== null || f.dismissedAt !== null);
    expect(decided.length).toBeGreaterThanOrEqual(8);

    const created: string[] = [];
    const refused: string[] = [];
    for (const finding of decided) {
      const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-case` });
      if (res.statusCode === 201) created.push(CreateEvalCaseFromFinding.parse(res.json()).case.id);
      else refused.push(`${res.statusCode} ${finding.title}: ${res.json()?.error?.message ?? ''}`);
    }

    expect(refused, 'the one-click path refused seeded findings').toEqual([]);
    expect(created.length).toBeGreaterThanOrEqual(8);
  });
});

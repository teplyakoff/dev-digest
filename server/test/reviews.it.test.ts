import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A unified diff touching src/config.ts (line 11 added) so grounding can keep a
 * finding on line 11 and drop one on line 999 / a non-existent file.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/**
 * A Review fixture: two valid findings (line 11, CRITICAL + SUGGESTION), one
 * hallucinated (line 999, WARNING). Grounding keeps the pair and drops the
 * phantom — which makes WARNING a real zero in the severity counters, the
 * distinction the PR list's null-vs-zero rule hinges on.
 */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
    {
      id: 'f-style',
      severity: 'SUGGESTION',
      category: 'style',
      title: 'Name the key via a typed config accessor',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'Inline literals in the config object hide provenance.',
      confidence: 0.7,
      kind: 'finding',
    },
  ],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  // persist the patch so the reviewer can reconstruct a diff (MockGit also returns one)
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('A2 reviews + agents (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(structured: unknown, provider: 'openai' | 'anthropic' = 'openai') {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          [provider]: new MockLLMProvider(provider, { structured }),
        },
      },
    });
  }

  it('agents CRUD', async () => {
    const app = await appWith(REVIEW_FIXTURE);

    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Test Reviewer',
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'You are a reviewer.',
      },
    });
    expect(created.statusCode).toBe(201);
    const agent = created.json();
    expect(agent.version).toBe(1);

    const list = (await app.inject({ method: 'GET', url: '/agents' })).json();
    expect(list.some((a: { id: string }) => a.id === agent.id)).toBe(true);

    // a config change bumps version
    const updated = (
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        payload: { system_prompt: 'Updated prompt.' },
      })
    ).json();
    expect(updated.version).toBe(2);

    await app.close();
  });

  it('runs a review: map-reduce + grounding drops the hallucinated finding, keeps the valid one', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Sec', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(1);

    // runReview is fire-and-forget: wait for the background run, then read the
    // persisted reviews (the POST returns runIds, not the reviews themselves).
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews).toHaveLength(1);

    const review = reviews[0];
    expect(review.verdict).toBe('request_changes');
    // Score is derived from the GROUNDED findings, not the model's self-reported
    // 42: grounding keeps the CRITICAL + SUGGESTION (line 11) ⇒ 100 − 35 − 3 = 62.
    expect(review.score).toBe(62);
    // grounding kept the two line-11 findings, dropped the line-999 one
    expect(review.findings).toHaveLength(2);
    expect(review.findings[0].file).toBe('src/config.ts');
    expect(review.findings[0].start_line).toBe(11);

    // a run_traces document was written (single doc)
    const runId = body.runs[0].run_id;
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.config.model).toBe('gpt-4.1');
    expect(trace.stats.grounding).toBe('2/3 passed');
    expect(trace.log.length).toBeGreaterThan(0);
    // Run cost badge: the spend the engine reported survives into the trace.
    expect(trace.stats.cost_usd).toBeCloseTo(0.001, 6);

    // agent_runs row populated for A5 to aggregate
    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.status).toBe('done');
    expect(run!.findingsCount).toBe(2);
    expect(run!.grounding).toBe('2/3 passed');
    // Cost is persisted on the run row — this is what the PR list and the run
    // history read. Null here would mean the badge silently shows "—".
    expect(run!.costUsd).toBeCloseTo(0.001, 6);

    // …and is exposed on the run-history route the timeline reads.
    const runs = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/runs` })).json();
    expect(runs[0].cost_usd).toBeCloseTo(0.001, 6);

    // …and denormalized onto the PR list as the latest run's cost.
    const pulls = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    const listed = pulls.find((p: { id: string }) => p.id === pr.id);
    expect(listed.cost_usd).toBeCloseTo(0.001, 6);

    // Severity counters on the list: the WARNING dropped by grounding must be a
    // real 0 (reviewed-clean severity), never null — the FINDINGS column's
    // null-vs-zero rule (docs/specs/02-severity-counters.md).
    expect(listed.findings_by_severity).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 1 });
    expect(listed.latest_findings).toHaveLength(2);
    const slimCritical = listed.latest_findings.find(
      (f: { severity: string }) => f.severity === 'CRITICAL',
    );
    expect(slimCritical).toMatchObject({
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      title: 'Hardcoded Stripe secret key',
    });
    expect(slimCritical.confidence).toBeCloseTo(0.95, 6);
    expect(typeof slimCritical.rationale).toBe('string');

    await app.close();
  });

  it('an enabled linked skill reaches the prompt, the trace and the log — a disabled one reaches only the log, to say it was skipped', async () => {
    // The L02 exit checklist, as one assertion pair. Everything else about the
    // run is held constant: same agent, same fixture, same diff — only the
    // skill's `enabled` flag moves.
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // A unique name per run: the seed now ships `test-quality-rubric` in this
    // same workspace, and the (workspace_id, name) unique index would reject a
    // second one — silently, three assertions before the confusing failure.
    const skillName = `branch-gate-${Math.random().toString(36).slice(2, 10)}`;
    const created = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: skillName,
        description: 'Flag new branches that no test asserts on.',
        type: 'rubric',
        body: '# Tests\nEvery new branch needs an assertion.',
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const skill = created.json();

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: `Skilled ${skillName}`,
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: 'sec',
          // repo-intel off so the prompt contains nothing but the parts we assert.
          repo_intel: false,
        },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });

    const traceFor = async (expected: number) => {
      const res = await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentId: agent.id },
      });
      await waitForPrRuns(pg.handle.db, pr.id, { expected });
      const runId = res.json().runs[0].run_id;
      return (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    };

    // ---- enabled ----------------------------------------------------------
    const on = await traceFor(1);
    expect(on.prompt_assembly.skills).toContain(`### ${skillName}`);
    expect(on.prompt_assembly.skills).toContain('Every new branch needs an assertion.');
    // The section is an instruction block, not delimiter-wrapped data — a skill
    // the guard tells the model to ignore would change nothing.
    expect(on.prompt_assembly.skills).not.toContain('<untrusted');
    expect(on.prompt_assembly.user).toContain('## Skills / rules');

    expect(on.config.skills).toEqual([
      { name: skillName, version: 1, tokens: expect.any(Number) },
    ]);
    expect(on.config.skills[0].tokens).toBeGreaterThan(0);
    expect(on.log.some((l: { msg: string }) => /Loaded 1 skill\(s\) \([\d,]+ tokens\)/.test(l.msg))).toBe(true);

    // ---- disabled ---------------------------------------------------------
    await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { enabled: false } });

    const off = await traceFor(2);
    expect(off.prompt_assembly.skills).toBeNull();
    expect(off.prompt_assembly.user).not.toContain('## Skills / rules');
    // Omitted, not an empty array — absent means "nothing loaded", and the UI
    // hides the row rather than rendering an empty one.
    expect(off.config.skills ?? null).toBeNull();
    // The LOG is the exception, and this assertion is the reverse of what it
    // used to be. The prompt and the trace stay silent, but a run whose only
    // linked skill is switched off has to say so — that is the one place someone
    // debugging "why is my skill not in the prompt?" will look.
    expect(
      off.log.some((l: { msg: string }) => /Loaded 0 skill\(s\) — 1 linked but disabled/.test(l.msg)),
    ).toBe(true);
    // Still no "loaded N tokens" claim, because nothing was loaded.
    expect(off.log.some((l: { msg: string }) => /tokens\)/.test(l.msg))).toBe(false);

    await app.close();
  });

  it('a failed run records NO cost — null, never 0 (the badge must read "—", not "$0.00")', async () => {
    // An invalid fixture makes the mock provider throw inside the run, which is
    // the deterministic stand-in for "the model call blew up".
    const app = await appWith({ verdict: 'not-a-verdict' });
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Doomed', provider: 'openai', model: 'gpt-4.1', system_prompt: 'rev' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const [run] = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.prId, pr.id));
    expect(run!.status).toBe('failed');
    // 0 would render as a real "$0.00" spend; unknown must stay unknown.
    expect(run!.costUsd).toBeNull();

    const trace = (await app.inject({ method: 'GET', url: `/runs/${run!.id}/trace` })).json();
    expect(trace.stats.cost_usd).toBeNull();

    // No review was ever persisted, so the list's severity counters must stay
    // null (unreviewed), not zero-seeded — zeros would claim a clean review.
    const pulls = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    const listed = pulls.find((p: { id: string }) => p.id === pr.id);
    expect(listed.findings_by_severity).toBeNull();
    expect(listed.latest_findings).toBeNull();

    await app.close();
  });

  it('dual-provider structured output: anthropic provider returns the same Review shape', async () => {
    const app = await appWith(REVIEW_FIXTURE, 'anthropic');
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Claude Rev', provider: 'anthropic', model: 'claude-x', system_prompt: 'rev' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    // Same fixture as the openai path: grounding keeps the two line-11 findings.
    expect(reviews[0].findings).toHaveLength(2);
    expect(reviews[0].model).toBe('claude-x');
    await app.close();
  });

  it('finding actions: accept, dismiss', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'ActAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    const findingId = reviews[0].findings[0].id;

    const accepted = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` })
    ).json();
    expect(accepted.finding.accepted_at).not.toBeNull();

    const dismissed = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/dismiss` })
    ).json();
    expect(dismissed.finding.dismissed_at).not.toBeNull();
    expect(dismissed.finding.accepted_at).toBeNull();

    await app.close();
  });

  it('SSE: /runs/:id/events streams events and completes', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'SseAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    // The run is synchronous; events are buffered on the bus. Subscribing after
    // the run still replays the buffer (replay-first semantics), then completes.
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    const runId = body.runs[0].run_id;

    const sse = await app.inject({ method: 'GET', url: `/runs/${runId}/events` });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');
    // The replay buffer should contain our log lines as SSE `data:` frames.
    expect(sse.payload).toContain('Starting review');
    expect(sse.payload).toContain('Citation grounding');
    await app.close();
  });

  it('run all enabled agents reviews with each enabled agent', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { all: true } })
    ).json();
    // seed has 2 enabled agents; we may have created more above in this PR's ws.
    expect(body.runs.length).toBeGreaterThanOrEqual(2);
    await app.close();
  });
});

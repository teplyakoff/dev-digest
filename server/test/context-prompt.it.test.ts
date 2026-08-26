import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns, waitForRunTrace } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import {
  MockEmbedder,
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
  console.warn('[context-prompt] Docker not available — skipping integration tests.');
}

/**
 * What a review actually sends, and what its trace actually records, once
 * documents are attached.
 *
 * The unit tests next door prove the ENGINE wraps a spec and that an absent slot
 * changes nothing. What only a real run can show is the half in between: that
 * the executor resolved the right documents from two sources, deduplicated them,
 * ordered them, wrote their names into `specs_read`, and said so in the run log
 * on every run — including the ones where there was nothing to say.
 */

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const INTENT_FIXTURE = {
  summary: 'Adds rate limiting to the public endpoints.',
  in_scope: ['rate limiting'],
  out_of_scope: [],
  confidence: 'medium',
};

const REVIEW_FIXTURE: Review = {
  verdict: 'comment',
  summary: 'Nothing blocking.',
  score: 90,
  findings: [
    {
      id: 'f1',
      severity: 'SUGGESTION',
      category: 'style',
      title: 'Name the key via a typed config accessor',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'Inline literals hide provenance.',
      confidence: 0.7,
      kind: 'finding',
    },
  ],
};

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let seq = 0;

d('project context in the prompt', () => {
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
   * EVERY external port is injected, and `llm` names all three provider ids —
   * not just the one this file is about. An un-injected port here is a live,
   * billed network call rather than a test failure, and its only symptom is
   * `waitForPrRuns` timing out. The empty `secrets` provider is the backstop
   * that turns the whole class into a loud `ConfigError` on every machine.
   */
  function makeApp() {
    const intentMock = () =>
      new MockLLMProvider('openai', { structuredBySchema: { IntentExtraction: INTENT_FIXTURE } });
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        secrets: new MockSecretsProvider({}),
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        sourceReader: new MockSourceReader({}),
        llm: {
          openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }),
          anthropic: intentMock(),
          openrouter: intentMock(),
        },
      },
    });
  }

  async function setupRepoAndPr() {
    const name = `ctx-prompt-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
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
        body: 'Add rate limiting.',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    return { repo: repo!, pr: pr! };
  }

  async function makeAgent(app: Awaited<ReturnType<typeof buildApp>>) {
    return (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: `ctx-agent-${seq++}`,
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: 'You are a reviewer.',
        },
      })
    ).json();
  }

  async function makeDoc(
    app: Awaited<ReturnType<typeof buildApp>>,
    repoId: string,
    name: string,
    body: string,
  ) {
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/context/docs`,
      payload: { kind: 'text', name, body },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  /**
   * The persisted trace for the PR's single run.
   *
   * `waitForRunTrace` rather than a bare select: the run reaching a terminal
   * status and its trace existing are two different moments, and the helper
   * carries the whole explanation.
   */
  async function traceFor(prId: string) {
    const [run] = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.prId, prId));

    const row = await waitForRunTrace(pg.handle.db, run!.id);
    expect(row, `no trace was persisted for run ${run!.id}`).toBeDefined();

    return row!.trace as {
      prompt_assembly: { specs: string | null; skills: string | null };
      specs_read: string[];
      log: Array<{ msg: string }>;
    };
  }

  describe('test_context_prompt_it', () => {
    it('sends the agent’s and its enabled skills’ documents, ordered and deduplicated', async () => {
      const app = await makeApp();
      const { repo, pr } = await setupRepoAndPr();
      const agent = await makeAgent(app);

      const zulu = await makeDoc(app, repo.id, 'zulu.md', '# zulu\nLast alphabetically.');
      const alpha = await makeDoc(app, repo.id, 'alpha.md', '# alpha\nFirst alphabetically.');
      const shared = await makeDoc(app, repo.id, 'shared.md', '# shared\nAttached twice.');

      // Two skills: one enabled, one switched off at the workspace level.
      const enabled = (
        await app.inject({
          method: 'POST',
          url: '/skills',
          payload: {
            name: `ctx-on-${Math.random().toString(36).slice(2, 8)}`,
            description: 'An enabled skill.',
            type: 'rubric',
            body: '# Enabled',
          },
        })
      ).json();
      const disabled = (
        await app.inject({
          method: 'POST',
          url: '/skills',
          payload: {
            name: `ctx-off-${Math.random().toString(36).slice(2, 8)}`,
            description: 'A disabled skill.',
            type: 'rubric',
            body: '# Disabled',
            enabled: false,
          },
        })
      ).json();
      await pg.handle.db.insert(t.agentSkills).values([
        { agentId: agent.id, skillId: enabled.id, order: 0 },
        { agentId: agent.id, skillId: disabled.id, order: 1 },
      ]);

      const secret = await makeDoc(app, repo.id, 'never.md', '# never\nBehind a disabled skill.');

      // Agent carries zulu + shared; the enabled skill carries alpha + shared
      // (the same document, from the other side); the disabled skill carries a
      // document that must not appear at all.
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/context-docs`,
        payload: { doc_ids: [zulu, shared] },
      });
      await app.inject({
        method: 'PUT',
        url: `/skills/${enabled.id}/context-docs`,
        payload: { doc_ids: [alpha, shared] },
      });
      await app.inject({
        method: 'PUT',
        url: `/skills/${disabled.id}/context-docs`,
        payload: { doc_ids: [secret] },
      });

      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentId: agent.id },
      });
      await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

      const trace = await traceFor(pr.id);

      // AC-14 — the names actually included, in prompt order. Three, not four:
      // `shared.md` was attached from both sides and appears once, and the
      // disabled skill's document is absent.
      expect(trace.specs_read).toEqual(['alpha.md', 'shared.md', 'zulu.md']);

      // AC-9/AC-10 — both sources really reached the model, wrapped.
      expect(trace.prompt_assembly.specs).toContain('First alphabetically.');
      expect(trace.prompt_assembly.specs).toContain('Attached twice.');
      expect(trace.prompt_assembly.specs).toContain('<untrusted source="spec-0">');

      // A globally disabled skill contributes nothing — neither its own body nor
      // anything attached to it. The master switch means the same thing for both.
      expect(trace.prompt_assembly.specs).not.toContain('Behind a disabled skill.');

      // NFR-1, at the level only a real run can check: the body is in the
      // wrapped slot and NOT in the trusted skills section.
      expect(trace.prompt_assembly.skills).not.toContain('First alphabetically.');

      // One occurrence, not two — the dedup happened before the wrap, so the
      // model is not shown the same document twice under two ids.
      const occurrences = trace.prompt_assembly.specs!.split('Attached twice.').length - 1;
      expect(occurrences).toBe(1);

      await app.close();
    });
  });

  describe('test_context_missing_it', () => {
    it('logs the count on a run with nothing attached at all', async () => {
      const app = await makeApp();
      const { pr } = await setupRepoAndPr();
      const agent = await makeAgent(app);

      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentId: agent.id },
      });
      await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

      const trace = await traceFor(pr.id);
      // NFR-5's threshold is 100 % of runs, and THIS is the run that tests it:
      // zero attachments, nothing skipped, nothing to report. A gate that
      // reports only when it acts is indistinguishable from a gate that never
      // ran, so `Project context:` missing from a trace has to mean exactly one
      // thing — this build does not have the feature.
      expect(trace.log.some((l) => l.msg === 'Project context: 0/0 document(s) loaded')).toBe(
        true,
      );
      expect(trace.specs_read).toEqual([]);
      // AC-15 — with nothing attached the slot is absent, not empty.
      expect(trace.prompt_assembly.specs).toBeNull();

      await app.close();
    });

    /**
     * AC-12 asks that "a deleted attached document is skipped and the run
     * completes". The schema answers it more strongly than the code does: the
     * attachment's FK is `ON DELETE CASCADE`, so deleting a document takes its
     * attachment rows with it and a DANGLING attachment cannot exist at all.
     *
     * The executor still counts and reports dangling ids, and `AttachedDoc`
     * still carries `missing` — defence in depth against a state a restore or a
     * manual fix-up could still produce. But that branch is unreachable through
     * the API, which is worth knowing rather than believing it is covered.
     */
    it('deleting an attached document detaches it, and the next run completes without it', async () => {
      const app = await makeApp();
      const { repo, pr } = await setupRepoAndPr();
      const agent = await makeAgent(app);

      const kept = await makeDoc(app, repo.id, 'kept.md', '# kept\nStill here.');
      const doomed = await makeDoc(app, repo.id, 'doomed.md', '# doomed\nAbout to vanish.');
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/context-docs`,
        payload: { doc_ids: [kept, doomed] },
      });

      await app.inject({
        method: 'DELETE',
        url: `/repos/${repo.id}/context/docs/${doomed}`,
      });
      // The cascade already removed the attachment row, so there is nothing left
      // pointing at a document that is not there.
      const rows = await pg.handle.db
        .select()
        .from(t.agentContextDocs)
        .where(eq(t.agentContextDocs.agentId, agent.id));
      expect(rows.map((r) => r.docId)).toEqual([kept]);

      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentId: agent.id },
      });
      const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

      // AC-12 — the run COMPLETES, with the surviving document and without the
      // deleted one. A document that has left the store is a gap in what the
      // model was given, not a reason to fail the review.
      expect(runs[0]!.status).toBe('done');

      const trace = await traceFor(pr.id);
      expect(trace.specs_read).toEqual(['kept.md']);
      expect(trace.prompt_assembly.specs).toContain('Still here.');
      expect(trace.prompt_assembly.specs).not.toContain('About to vanish.');

      // AC-13 — the line is present, and its two numbers are the store's truth
      // rather than the attachment set's memory of it.
      expect(trace.log.some((l) => l.msg === 'Project context: 1/1 document(s) loaded')).toBe(
        true,
      );

      await app.close();
    });
  });
});

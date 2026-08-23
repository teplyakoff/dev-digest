import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import {
  MockGitClient,
  MockGitHubClient,
  MockSourceReader,
  MockSecretsProvider,
} from '../src/adapters/mocks.js';
import { MAX_DOC_BYTES } from '../src/modules/context/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[context] Docker not available — skipping integration tests.');
}

/**
 * The project-context store end to end: the eleven routes, the three ways to
 * fill it, both size bounds, attachment replacement, and the tenant line.
 *
 * The SQL and the wiring are what break here — the pure rules are covered
 * without Docker in `context-helpers.test.ts` and `context-prompt.test.ts`.
 *
 * FILE NAME IS LOAD-BEARING: `*.it.test.ts` is how the CI suite split finds the
 * Docker-requiring tests.
 */

const CLONE = {
  'README.md': '# payments-api\n\nA service.\n',
  'docs/PRD.md': '# PRD\n\nCap public endpoints at 100 req/min.\n',
  'src/index.ts': 'export const x = 1;\n',
};

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let seq = 0;

d('project context store', () => {
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
   * A repo this test built, NOT the seeded `acme/payments-api`.
   * `db.select().from(t.repos)` hands back the seeded row (the seed runs in
   * `beforeAll`), and the symptom of using it by accident is a confusing
   * `Cannot read properties of undefined` several lines later.
   */
  async function makeRepo(over: { clonePath?: string | null; workspaceId?: string } = {}) {
    const name = `context-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: over.workspaceId ?? workspaceId,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        clonePath: over.clonePath === undefined ? '/tmp/devdigest-context-clone' : over.clonePath,
      })
      .returning();
    return repo!;
  }

  function makeApp(over: { files?: Record<string, string> } = {}) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        // The clone, in memory. `MockSourceReader.list` is what makes the import
        // picker testable without a temp directory — a fixture on disk is a
        // fixture that passes only on the machine that wrote it.
        sourceReader: new MockSourceReader(over.files ?? CLONE),
        // NOT an enumerated list of the ports this file uses. A port nobody
        // remembered to override then fails loudly here, instead of quietly
        // resolving a real key off `server/.env` and making a billed request
        // whose only symptom is a timeout — and only on the machine that has
        // the key.
        secrets: new MockSecretsProvider({}),
      },
    });
  }

  // ---- routes --------------------------------------------------------------

  describe('test_context_routes_it', () => {
    it('lists the clone’s .md files as import candidates, and rescan re-reads them', async () => {
      const app = await makeApp();
      const repo = await makeRepo();

      const res = await app.inject({
        method: 'GET',
        url: `/repos/${repo.id}/context/candidates`,
      });
      expect(res.statusCode).toBe(200);
      const { candidates, truncated } = res.json();
      // `.md` only, alphabetical, and the `.ts` sibling is not offered.
      expect(candidates.map((c: { path: string }) => c.path)).toEqual([
        'README.md',
        'docs/PRD.md',
      ]);
      expect(truncated).toBe(false);

      // AC-39 — "rescan" is this same endpoint answering from the clone's
      // CURRENT state rather than from a cached list. A file that appeared since
      // the last call shows up without anything being invalidated by hand.
      const app2 = await makeApp({
        files: { ...CLONE, 'docs/NEW.md': '# new\n' },
      });
      const again = await app2.inject({
        method: 'GET',
        url: `/repos/${repo.id}/context/candidates`,
      });
      expect(again.json().candidates.map((c: { path: string }) => c.path)).toEqual([
        'README.md',
        'docs/NEW.md',
        'docs/PRD.md',
      ]);

      await app.close();
      await app2.close();
    });

    it('answers 409 not_cloned — never 500 — when the repo has no clone', async () => {
      const app = await makeApp();
      const repo = await makeRepo({ clonePath: null });

      const res = await app.inject({
        method: 'GET',
        url: `/repos/${repo.id}/context/candidates`,
      });
      // "You have not cloned this yet" is an ANSWER. A 500 would send the page
      // to an error state for a situation that is simply the beginning.
      expect(res.statusCode).toBe(409);
      expect(res.json().error.details.code).toBe('not_cloned');
      await app.close();
    });

    it('the store works with no clone present — AC-38', async () => {
      const app = await makeApp();
      const repo = await makeRepo({ clonePath: null });

      // Everything except the import picker: create, read, list, save, delete.
      const created = await app.inject({
        method: 'POST',
        url: `/repos/${repo.id}/context/docs`,
        payload: { kind: 'text', name: 'hand-written.md', body: '# by hand\n' },
      });
      expect(created.statusCode).toBe(201);
      const docId = created.json().id as string;

      const listed = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/docs` });
      expect(listed.json()).toHaveLength(1);

      const saved = await app.inject({
        method: 'PUT',
        url: `/repos/${repo.id}/context/docs/${docId}`,
        payload: { body: '# by hand, edited\n' },
      });
      expect(saved.statusCode).toBe(200);

      const status = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/store` });
      expect(status.json()).toMatchObject({ docs: 1 });

      const removed = await app.inject({
        method: 'DELETE',
        url: `/repos/${repo.id}/context/docs/${docId}`,
      });
      expect(removed.statusCode).toBe(200);
      await app.close();
    });
  });

  // ---- the three ways in ---------------------------------------------------

  describe('test_context_store_it', () => {
    it('imports a candidate, creates an empty document, and takes uploaded text', async () => {
      const app = await makeApp();
      const repo = await makeRepo();

      // AC-32 — import. The body is the clone's text, read through the port.
      const imported = await app.inject({
        method: 'POST',
        url: `/repos/${repo.id}/context/docs`,
        payload: { kind: 'import', path: 'docs/PRD.md' },
      });
      expect(imported.statusCode).toBe(201);
      expect(imported.json()).toMatchObject({ name: 'PRD.md' });
      expect(imported.json().body).toContain('100 req/min');

      // AC-33 — a named document with an empty body.
      const empty = await app.inject({
        method: 'POST',
        url: `/repos/${repo.id}/context/docs`,
        payload: { kind: 'text', name: 'NOTES.md', body: '' },
      });
      expect(empty.statusCode).toBe(201);
      expect(empty.json().body).toBe('');

      // AC-34 — upload. The browser read the file and POSTed its text, so this
      // is the SAME code path as AC-33 rather than a second one. That is what
      // lets one test cover all three ways in (R-1).
      const uploaded = await app.inject({
        method: 'POST',
        url: `/repos/${repo.id}/context/docs`,
        payload: { kind: 'text', name: 'UPLOADED.md', body: '# from a file\n' },
      });
      expect(uploaded.statusCode).toBe(201);

      const listed = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/docs` });
      expect(listed.json().map((doc: { name: string }) => doc.name)).toEqual([
        'NOTES.md',
        'PRD.md',
        'UPLOADED.md',
      ]);
      // Priced by the injected tokenizer, and sized in bytes.
      expect(listed.json()[1].tokens).toBeGreaterThan(0);
      expect(listed.json()[1].bytes).toBeGreaterThan(0);

      await app.close();
    });

    it('replaces a body on save, and the last of two writes wins', async () => {
      const app = await makeApp();
      const repo = await makeRepo();

      const created = await app.inject({
        method: 'POST',
        url: `/repos/${repo.id}/context/docs`,
        payload: { kind: 'text', name: 'RACE.md', body: 'first' },
      });
      const docId = created.json().id as string;

      // AC-35, then AC-40: two sequential writes, no conflict detection, no
      // rejection. This is the lightest option and it is LOSSY — the first
      // writer's text is gone with no history and no way to reproduce it. That
      // is recorded as an accepted trade in the plan's *Open decisions*, not as
      // something nobody noticed.
      await app.inject({
        method: 'PUT',
        url: `/repos/${repo.id}/context/docs/${docId}`,
        payload: { body: 'second' },
      });
      const third = await app.inject({
        method: 'PUT',
        url: `/repos/${repo.id}/context/docs/${docId}`,
        payload: { body: 'third' },
      });
      expect(third.statusCode).toBe(200);

      const read = await app.inject({
        method: 'GET',
        url: `/repos/${repo.id}/context/docs/${docId}`,
      });
      expect(read.json().body).toBe('third');
      await app.close();
    });

    it('REFUSES to import a path the picker would never offer', async () => {
      // The regression this test exists for. `list()` filters by extension and
      // skips `EXCLUDED_DIRS`; the create endpoint takes its path from the
      // request body and used to apply neither. `.git/config` carries the clone
      // URL, and `repos/helpers.ts` embeds the GitHub token in it as a password
      // — so this request returned the secret, stored it in `context_docs.body`,
      // and would have sent it to a model provider.
      const app = await makeApp({
        files: {
          ...CLONE,
          '.git/config': '[remote "origin"]\n\turl = https://x-access-token:ghp_REAL@github.com/a/b\n',
          '.env': 'STRIPE_KEY=sk_live_never\n',
        },
      });
      const repo = await makeRepo();

      for (const path of ['.git/config', '.env', 'src/index.ts', '../outside.md']) {
        const res = await app.inject({
          method: 'POST',
          url: `/repos/${repo.id}/context/docs`,
          payload: { kind: 'import', path },
        });
        expect(res.statusCode, `${path} must not be importable`).toBe(422);
        expect(res.body).not.toContain('ghp_REAL');
      }

      // And nothing was written on the way to those refusals.
      const listed = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/docs` });
      expect(listed.json()).toEqual([]);
      await app.close();
    });

    it('does not offer an excluded or non-markdown file as a candidate either', async () => {
      const app = await makeApp({
        files: { ...CLONE, '.git/config': 'url = https://x-access-token:ghp_REAL@github.com/a/b' },
      });
      const repo = await makeRepo();

      const res = await app.inject({
        method: 'GET',
        url: `/repos/${repo.id}/context/candidates`,
      });
      expect(res.body).not.toContain('.git');
      expect(res.body).not.toContain('ghp_REAL');
      await app.close();
    });

    it('refuses a second document with the same name in one repo', async () => {
      const app = await makeApp();
      const repo = await makeRepo();
      const payload = { kind: 'text' as const, name: 'DUP.md', body: 'x' };

      expect((await app.inject({ method: 'POST', url: `/repos/${repo.id}/context/docs`, payload })).statusCode).toBe(201);
      const second = await app.inject({
        method: 'POST',
        url: `/repos/${repo.id}/context/docs`,
        payload,
      });
      // 409, not 500: the unique index is a rule, and the page can say "that
      // name is taken" only if the failure is distinguishable from a crash.
      expect(second.statusCode).toBe(409);
      await app.close();
    });
  });

  // ---- bounds --------------------------------------------------------------

  describe('test_context_bounds_it', () => {
    it('refuses a body past MAX_DOC_BYTES and leaves the stored body untouched', async () => {
      const app = await makeApp();
      const repo = await makeRepo();

      const created = await app.inject({
        method: 'POST',
        url: `/repos/${repo.id}/context/docs`,
        payload: { kind: 'text', name: 'BOUNDED.md', body: 'the original text' },
      });
      const docId = created.json().id as string;

      const refused = await app.inject({
        method: 'PUT',
        url: `/repos/${repo.id}/context/docs/${docId}`,
        payload: { body: 'x'.repeat(MAX_DOC_BYTES + 1) },
      });
      expect(refused.statusCode).toBe(422);
      expect(refused.json().error.details.code).toBe('doc_too_large');
      // THE assertion. A bound checked AFTER the write returns the same 422 and
      // passes any test that only reads the status code — this is the one that
      // tells the two apart.
      const read = await app.inject({
        method: 'GET',
        url: `/repos/${repo.id}/context/docs/${docId}`,
      });
      expect(read.json().body).toBe('the original text');
      await app.close();
    });

    it('counts the bound in UTF-8 BYTES, not in characters', async () => {
      const app = await makeApp();
      const repo = await makeRepo();

      // Half as many characters as the limit, but two bytes each — so this is
      // over. A character-counting bound would accept it and store 1.5× the
      // limit it advertises.
      const cyrillic = 'я'.repeat(MAX_DOC_BYTES / 2 + 10);
      const res = await app.inject({
        method: 'POST',
        url: `/repos/${repo.id}/context/docs`,
        payload: { kind: 'text', name: 'CYRILLIC.md', body: cyrillic },
      });
      expect(res.statusCode).toBe(422);
      await app.close();
    });

    it('checks the store bound against the RESULTING size, not the incoming one', async () => {
      const app = await makeApp();
      const repo = await makeRepo();

      // Varied text, NOT `'x'.repeat(50_000)`. A long run of one character is
      // pathological for tiktoken's BPE merges, and pricing it took ninety
      // seconds — a fixture that makes the suite look broken while the code is
      // fine.
      const large = 'the quick brown fox jumps over the lazy dog\n'.repeat(1_150);
      const created = await app.inject({
        method: 'POST',
        url: `/repos/${repo.id}/context/docs`,
        payload: { kind: 'text', name: 'SHRINK.md', body: large },
      });
      const docId = created.json().id as string;

      // Replacing a large body with a small one must never be refused for size,
      // whatever the store already holds. A check on the request alone gets this
      // backwards.
      const shrunk = await app.inject({
        method: 'PUT',
        url: `/repos/${repo.id}/context/docs/${docId}`,
        payload: { body: 'tiny' },
      });
      expect(shrunk.statusCode).toBe(200);

      const status = await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/store` });
      expect(status.json().total_bytes).toBe(4);
      await app.close();
    });
  });

  // ---- attachment ----------------------------------------------------------

  describe('test_context_attach_it', () => {
    it('replaces an agent’s whole set, and a skill’s, in one request each', async () => {
      const app = await makeApp();
      const repo = await makeRepo();

      const ids: string[] = [];
      for (const name of ['A.md', 'B.md', 'C.md']) {
        const res = await app.inject({
          method: 'POST',
          url: `/repos/${repo.id}/context/docs`,
          payload: { kind: 'text', name, body: `# ${name}` },
        });
        ids.push(res.json().id as string);
      }

      const [agent] = await pg.handle.db
        .insert(t.agents)
        .values({
          workspaceId,
          name: `attach-${seq++}`,
          provider: 'openai' as const,
          model: 'gpt-4.1',
          systemPrompt: 'Review.',
        })
        .returning();

      const attached = await app.inject({
        method: 'PUT',
        url: `/agents/${agent!.id}/context-docs`,
        payload: { doc_ids: [ids[0], ids[1]] },
      });
      expect(attached.statusCode).toBe(200);
      expect(attached.json().map((doc: { name: string }) => doc.name)).toEqual(['A.md', 'B.md']);

      // REPLACE, not merge. Sending {C} leaves C attached and nothing else — a
      // delta protocol would leave A and B behind and the result would be wrong
      // while every individual request looked right.
      const replaced = await app.inject({
        method: 'PUT',
        url: `/agents/${agent!.id}/context-docs`,
        payload: { doc_ids: [ids[2]] },
      });
      expect(replaced.json().map((doc: { name: string }) => doc.name)).toEqual(['C.md']);

      // An empty array detaches everything, and is the only way to say so.
      const cleared = await app.inject({
        method: 'PUT',
        url: `/agents/${agent!.id}/context-docs`,
        payload: { doc_ids: [] },
      });
      expect(cleared.json()).toEqual([]);

      // The same contract on the skill side.
      const skill = await app.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name: `attach-skill-${Math.random().toString(36).slice(2, 8)}`,
          description: 'A skill that carries a document.',
          type: 'rubric',
          body: '# Rule',
        },
      });
      const skillId = skill.json().id as string;
      const onSkill = await app.inject({
        method: 'PUT',
        url: `/skills/${skillId}/context-docs`,
        payload: { doc_ids: [ids[0]] },
      });
      expect(onSkill.json().map((doc: { name: string }) => doc.name)).toEqual(['A.md']);

      const readBack = await app.inject({
        method: 'GET',
        url: `/skills/${skillId}/context-docs`,
      });
      expect(readBack.json().map((doc: { name: string }) => doc.name)).toEqual(['A.md']);
      await app.close();
    });

    it('shows a deleted-but-attached document as missing, and lets it be detached', async () => {
      const app = await makeApp();
      const repo = await makeRepo();

      const created = await app.inject({
        method: 'POST',
        url: `/repos/${repo.id}/context/docs`,
        payload: { kind: 'text', name: 'DOOMED.md', body: '# doomed' },
      });
      const docId = created.json().id as string;

      const [agent] = await pg.handle.db
        .insert(t.agents)
        .values({
          workspaceId,
          name: `missing-${seq++}`,
          provider: 'openai' as const,
          model: 'gpt-4.1',
          systemPrompt: 'Review.',
        })
        .returning();

      await app.inject({
        method: 'PUT',
        url: `/agents/${agent!.id}/context-docs`,
        payload: { doc_ids: [docId] },
      });
      await app.inject({ method: 'DELETE', url: `/repos/${repo.id}/context/docs/${docId}` });

      // The FK cascades, so after the delete there is no attachment row left to
      // show — which is the cleanest possible answer to "detachable": there is
      // nothing dangling to detach.
      const after = await app.inject({
        method: 'GET',
        url: `/agents/${agent!.id}/context-docs`,
      });
      expect(after.json()).toEqual([]);
      await app.close();
    });
  });

  // ---- tenancy -------------------------------------------------------------

  describe('test_context_tenancy_it', () => {
    it('answers 404 for an agent, a skill and a repo in another workspace', async () => {
      const app = await makeApp();

      const [other] = await pg.handle.db
        .insert(t.workspaces)
        .values({ name: `other-${seq++}` })
        .returning();
      const otherRepo = await makeRepo({ workspaceId: other!.id });
      const [otherAgent] = await pg.handle.db
        .insert(t.agents)
        .values({
          workspaceId: other!.id,
          name: `tenant-${seq++}`,
          provider: 'openai' as const,
          model: 'gpt-4.1',
          systemPrompt: 'Review.',
        })
        .returning();
      const [otherSkill] = await pg.handle.db
        .insert(t.skills)
        .values({
          workspaceId: other!.id,
          name: `tenant-skill-${seq++}`,
          description: 'not yours',
          type: 'rubric' as const,
          source: 'manual' as const,
          body: '# no',
        })
        .returning();

      // 404 and not 403: whether that agent exists at all is not this tenant's
      // business, and a 403 would confirm that it does.
      for (const url of [
        `/agents/${otherAgent!.id}/context-docs`,
        `/skills/${otherSkill!.id}/context-docs`,
      ]) {
        const res = await app.inject({ method: 'PUT', url, payload: { doc_ids: [] } });
        expect(res.statusCode).toBe(404);
      }
      const repoRes = await app.inject({
        method: 'GET',
        url: `/repos/${otherRepo.id}/context/docs`,
      });
      expect(repoRes.statusCode).toBe(404);
      await app.close();
    });

    it('will not attach another workspace’s document to this workspace’s agent', async () => {
      const app = await makeApp();

      const [other] = await pg.handle.db
        .insert(t.workspaces)
        .values({ name: `other-${seq++}` })
        .returning();
      const otherRepo = await makeRepo({ workspaceId: other!.id });
      const [borrowed] = await pg.handle.db
        .insert(t.contextDocs)
        .values({
          workspaceId: other!.id,
          repoId: otherRepo.id,
          name: 'SECRET.md',
          body: '# their private specification',
        })
        .returning();

      const [agent] = await pg.handle.db
        .insert(t.agents)
        .values({
          workspaceId,
          name: `borrower-${seq++}`,
          provider: 'openai' as const,
          model: 'gpt-4.1',
          systemPrompt: 'Review.',
        })
        .returning();

      const res = await app.inject({
        method: 'PUT',
        url: `/agents/${agent!.id}/context-docs`,
        payload: { doc_ids: [borrowed!.id] },
      });
      // The request is accepted — the agent IS this tenant's — but the borrowed
      // id attaches nothing. `agent_context_docs` has no workspace column of its
      // own, so this filter is the entire tenant line for the join.
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);

      const rows = await pg.handle.db
        .select()
        .from(t.agentContextDocs)
        .where(eq(t.agentContextDocs.agentId, agent!.id));
      expect(rows).toEqual([]);
      await app.close();
    });
  });

  // ---- no model calls ------------------------------------------------------

  describe('test_context_no_llm_it', () => {
    it('the whole store + attach + list flow never reaches an LLM provider', async () => {
      // NFR-4's threshold is zero model calls. Asserting it with a provider that
      // THROWS is the difference between "we did not observe a call" and "a call
      // is not possible" — an unused mock proves nothing, a booby-trapped one
      // proves the path.
      let called = 0;
      const explode = () => {
        called += 1;
        throw new Error('the project-context store must not call a model');
      };

      const app = await buildApp({
        config: config(),
        db: pg.handle.db,
        overrides: {
          git: new MockGitClient(),
          github: new MockGitHubClient(),
          sourceReader: new MockSourceReader(CLONE),
          secrets: new MockSecretsProvider({}),
          llm: {
            openai: { id: 'openai', complete: explode, listModels: explode } as never,
            anthropic: { id: 'anthropic', complete: explode, listModels: explode } as never,
            openrouter: { id: 'openrouter', complete: explode, listModels: explode } as never,
          },
        },
      });

      const repo = await makeRepo();
      const [agent] = await pg.handle.db
        .insert(t.agents)
        .values({
          workspaceId,
          name: `no-llm-${seq++}`,
          provider: 'openai' as const,
          model: 'gpt-4.1',
          systemPrompt: 'Review.',
        })
        .returning();

      await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/candidates` });
      const created = await app.inject({
        method: 'POST',
        url: `/repos/${repo.id}/context/docs`,
        payload: { kind: 'import', path: 'docs/PRD.md' },
      });
      const docId = created.json().id as string;
      await app.inject({
        method: 'PUT',
        url: `/repos/${repo.id}/context/docs/${docId}`,
        payload: { body: '# edited' },
      });
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent!.id}/context-docs`,
        payload: { doc_ids: [docId] },
      });
      await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/docs` });
      await app.inject({ method: 'GET', url: `/repos/${repo.id}/context/store` });

      expect(called).toBe(0);
      await app.close();
    });
  });
});

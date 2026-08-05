import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills] Docker not available — skipping integration tests.');
}

/**
 * The skills module end to end: CRUD, body versioning, the per-workspace unique
 * name, cross-tenant isolation, and the usage join. The SQL and the wiring are
 * what break here, which is why this is an integration test and
 * `skills-helpers.test.ts` covers the pure rules with no Docker.
 */
d('skills module', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  const body = (over: Record<string, unknown> = {}) => ({
    name: `skill-${Math.random().toString(36).slice(2, 10)}`,
    description: 'Flag new branches that no test asserts on.',
    type: 'rubric' as const,
    body: '# Tests\nCover new branches.',
    ...over,
  });

  it('creates a skill, snapshots v1, and lists it', async () => {
    const app = await makeApp();
    const payload = body();
    const created = await app.inject({ method: 'POST', url: '/skills', payload });
    expect(created.statusCode).toBe(201);
    const skill = created.json();
    expect(skill).toMatchObject({ name: payload.name, version: 1, enabled: true, source: 'manual' });

    const versions = await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` });
    expect(versions.json()).toEqual([
      expect.objectContaining({ skill_id: skill.id, version: 1, body: payload.body }),
    ]);

    const list = await app.inject({ method: 'GET', url: '/skills' });
    expect(list.json().map((s: { id: string }) => s.id)).toContain(skill.id);
    await app.close();
  });

  it('bumps the version and snapshots ONLY when the body changes', async () => {
    const app = await makeApp();
    const created = await app.inject({ method: 'POST', url: '/skills', payload: body() });
    const id = created.json().id as string;

    // Metadata-only edits: same version, still one snapshot. Renaming a skill
    // must not invalidate the eval history of text that never changed.
    const renamed = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { name: 'renamed-skill', description: 'new words', enabled: false },
    });
    expect(renamed.json()).toMatchObject({ name: 'renamed-skill', version: 1, enabled: false });
    expect((await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json()).toHaveLength(1);

    // Body edit: v2, newest first, and the old text is still readable.
    const edited = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { body: '# Tests\nCover new branches AND their boundaries.' },
    });
    expect(edited.json().version).toBe(2);

    const versions = (await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);

    const v1 = await app.inject({ method: 'GET', url: `/skills/${id}/versions/1` });
    expect(v1.json().body).toBe('# Tests\nCover new branches.');
    await app.close();
  });

  it('answers a duplicate name with 409 — not a 500 carrying the constraint name', async () => {
    const app = await makeApp();
    const payload = body({ name: 'duplicate-name-gate' });
    expect((await app.inject({ method: 'POST', url: '/skills', payload })).statusCode).toBe(201);

    // The unique index (migration 0012) is the guard: the name is the block
    // heading the model reads, so two skills sharing one makes both ambiguous.
    // Tripping it is a ROUTINE user action — re-importing the same file hits it
    // every time, since the name is derived from the filename — so it has to be
    // an answer, not a server error.
    const second = await app.inject({ method: 'POST', url: '/skills', payload });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('conflict');
    expect(second.json().error.message).toContain('duplicate-name-gate');
    // The raw constraint name must not reach the client.
    expect(second.body).not.toContain('skills_workspace_id_name_uq');
    await app.close();
  });

  it('answers a rename onto a taken name with 409 too', async () => {
    const app = await makeApp();
    const taken = body({ name: 'already-taken-name' });
    await app.inject({ method: 'POST', url: '/skills', payload: taken });
    const other = (await app.inject({ method: 'POST', url: '/skills', payload: body() })).json();

    const renamed = await app.inject({
      method: 'PUT',
      url: `/skills/${other.id}`,
      payload: { name: 'already-taken-name' },
    });
    expect(renamed.statusCode).toBe(409);
    expect(renamed.body).not.toContain('skills_workspace_id_name_uq');
    await app.close();
  });

  it('re-importing the same file is a 409, not a 500 — the name is derived, so it always collides', async () => {
    const app = await makeApp();
    const upload = {
      filename: 'repeat-import-gate.md',
      content_base64: Buffer.from('# Rule\n\nFlag it.', 'utf8').toString('base64'),
    };
    const preview = await app.inject({ method: 'POST', url: '/skills/import/preview', payload: upload });
    expect(preview.statusCode).toBe(200);

    const first = await app.inject({
      method: 'POST',
      url: '/skills/import/confirm',
      payload: preview.json(),
    });
    expect(first.statusCode).toBe(201);
    // Imported skills land disabled — the trust boundary, asserted here because
    // this is the only route that writes one.
    expect(first.json()).toMatchObject({ enabled: false, source: 'imported_file' });

    const again = await app.inject({
      method: 'POST',
      url: '/skills/import/confirm',
      payload: preview.json(),
    });
    expect(again.statusCode).toBe(409);
    await app.close();
  });

  it('validates the name shape at the edge', async () => {
    const app = await makeApp();
    for (const name of ['Has Spaces', 'UPPER', '-leading-hyphen', 'a']) {
      const res = await app.inject({ method: 'POST', url: '/skills', payload: body({ name }) });
      expect(res.statusCode, `expected 422 for ${name}`).toBe(422);
    }
    await app.close();
  });

  it('scopes every read to the workspace', async () => {
    const app = await makeApp();
    const created = await app.inject({ method: 'POST', url: '/skills', payload: body() });
    const id = created.json().id as string;

    // Move the skill to another workspace behind the API's back; every route
    // must now behave as if it does not exist.
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-${Math.random().toString(36).slice(2, 8)}` })
      .returning();
    await pg.handle.db
      .update(t.skills)
      .set({ workspaceId: other!.id })
      .where(eq(t.skills.id, id));

    for (const url of [
      `/skills/${id}`,
      `/skills/${id}/versions`,
      `/skills/${id}/agents`,
      `/skills/${id}/stats`,
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(404);
    }
    expect((await app.inject({ method: 'DELETE', url: `/skills/${id}` })).statusCode).toBe(404);
    await app.close();
  });

  it('reports which agents use a skill, and deleting it unlinks without touching them', async () => {
    const app = await makeApp();
    const skillId = (await app.inject({ method: 'POST', url: '/skills', payload: body() })).json()
      .id as string;
    const agentId = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: `Linker ${Math.random().toString(36).slice(2, 8)}`,
          provider: 'openai',
          model: 'gpt-4o-mini',
          system_prompt: 'Review the diff.',
        },
      })
    ).json().id as string;

    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [skillId] },
    });

    const usage = await app.inject({ method: 'GET', url: `/skills/${skillId}/agents` });
    expect(usage.json()).toEqual([expect.objectContaining({ agent_id: agentId })]);

    expect((await app.inject({ method: 'DELETE', url: `/skills/${skillId}` })).statusCode).toBe(200);
    // The link cascades; the agent survives — deleting a shared skill must not
    // take three agents down with it.
    expect((await app.inject({ method: 'GET', url: `/agents/${agentId}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/agents/${agentId}/skills` })).json()).toEqual([]);
    await app.close();
  });

  /**
   * `GET /skills/:id/stats` reads the run traces back, so the assertions below
   * write traces by hand rather than triggering runs — the shape of
   * `trace.config.skills` is the contract under test, not the executor.
   */
  it('adds up what a skill cost across the runs that loaded it', async () => {
    const app = await makeApp();
    const payload = body();
    const skillId = (await app.inject({ method: 'POST', url: '/skills', payload })).json()
      .id as string;

    const statsOf = async () =>
      (await app.inject({ method: 'GET', url: `/skills/${skillId}/stats` })).json();

    // Never loaded: zeroes and a null, not a 404 and not a NaN average.
    expect(await statsOf()).toMatchObject({
      agents: [],
      runs: 0,
      tokens_total: 0,
      tokens_avg: 0,
      last_loaded_at: null,
    });

    // The runs must land in the SAME workspace the API reads as, so take it off
    // the skill the API just created rather than guessing at the row order of
    // `workspaces` — an earlier test in this file inserts a second one.
    const [row] = await pg.handle.db.select().from(t.skills).where(eq(t.skills.id, skillId));
    const writeRun = async (ranAt: Date, trace: unknown) => {
      const [run] = await pg.handle.db
        .insert(t.agentRuns)
        .values({ workspaceId: row!.workspaceId, ranAt, status: 'done' })
        .returning();
      await pg.handle.db.insert(t.runTraces).values({ runId: run!.id, trace });
    };
    const traceWith = (skills: unknown) => ({ config: { agent: 'A', model: 'm', skills } });

    await writeRun(
      new Date('2026-08-01T10:00:00Z'),
      traceWith([{ name: payload.name, version: 1, tokens: 300 }]),
    );
    await writeRun(
      new Date('2026-08-02T10:00:00Z'),
      // A second skill in the same run: only this one's tokens count.
      traceWith([
        { name: 'some-other-skill', version: 1, tokens: 999 },
        { name: payload.name, version: 2, tokens: 500 },
      ]),
    );

    // A run that loaded nothing, and a pre-L02 trace with no `skills` key at
    // all. Both must be ignored rather than crash `jsonb_array_elements`.
    await writeRun(new Date('2026-08-03T10:00:00Z'), traceWith(null));
    await writeRun(new Date('2026-08-04T10:00:00Z'), { config: { agent: 'A', model: 'm' } });

    const stats = await statsOf();
    expect(stats).toMatchObject({ runs: 2, tokens_total: 800, tokens_avg: 400 });
    // The newest run that loaded THIS skill — not the newest run overall.
    expect(new Date(stats.last_loaded_at).toISOString()).toBe('2026-08-02T10:00:00.000Z');
    await app.close();
  });

  /**
   * The other direction of the same join. `Skill.used_by` has been on the list
   * since L02; `Agent.skills_count` was the half nobody wired, so every agent
   * card rendered without its badge.
   */
  it('denormalizes skills_count onto the agent list, and nowhere else', async () => {
    const app = await makeApp();
    const agentId = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: `Counter ${Math.random().toString(36).slice(2, 8)}`,
          provider: 'openai',
          model: 'gpt-4o-mini',
          system_prompt: 'Review the diff.',
        },
      })
    ).json().id as string;

    const countOf = async (id: string) => {
      const list = (await app.inject({ method: 'GET', url: '/agents' })).json() as Array<{
        id: string;
        skills_count?: number;
      }>;
      return list.find((a) => a.id === id)?.skills_count;
    };

    // A fresh agent reports 0 — a real answer, not a missing one.
    expect(await countOf(agentId)).toBe(0);

    const first = (await app.inject({ method: 'POST', url: '/skills', payload: body() })).json()
      .id as string;
    const second = (await app.inject({ method: 'POST', url: '/skills', payload: body() })).json()
      .id as string;
    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [first, second] },
    });
    expect(await countOf(agentId)).toBe(2);

    // Disabling a skill does NOT change the count: the card mirrors the editor's
    // Skills tab, which still lists the row with its toggle off.
    await app.inject({ method: 'PUT', url: `/skills/${first}`, payload: { enabled: false } });
    expect(await countOf(agentId)).toBe(2);

    // Unlinking does, and deleting the skill unlinks it.
    await app.inject({ method: 'DELETE', url: `/skills/${second}` });
    expect(await countOf(agentId)).toBe(1);

    // The single-agent read stays clean — absent, so the client can tell "not
    // loaded" from "zero".
    const one = (await app.inject({ method: 'GET', url: `/agents/${agentId}` })).json();
    expect(one).not.toHaveProperty('skills_count');
    await app.close();
  });
});

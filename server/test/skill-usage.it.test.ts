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
  MockSecretsProvider,
} from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skill-usage] Docker not available — skipping integration tests.');
}

/**
 * AC-16 — "report how many agents use each skill".
 *
 * This is a PIN, not a build. `SkillsRepository.usageCounts` and `Skill.used_by`
 * already ship and already answer this on `GET /skills`; SPEC-06 restates the
 * criterion because its Project Context page consumes the number, not because
 * the number is new.
 *
 * Writing a second usage aggregate inside `modules/context/` — which is what
 * "this criterion is in my spec, so I build it" would produce — gives two
 * sources of truth for one sentence. They will disagree the first time one is
 * invalidated and the other is not, and the disagreement will be silent.
 */
d('skill usage count (AC-16, pinned)', () => {
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

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        // Not an enumeration of the ports this test happens to use. An empty
        // secrets provider makes any port this test FORGOT to override fail
        // loudly instead of quietly reaching for a real key — the bug whose only
        // symptom is a timeout, and only on the machine that has the key.
        secrets: new MockSecretsProvider({}),
      },
    });
  }

  it('test_skill_usage_it — two agents linked to one skill report used_by: 2', async () => {
    const app = await makeApp();

    const created = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: `usage-pin-${Math.random().toString(36).slice(2, 8)}`,
        description: 'A skill two agents load.',
        type: 'rubric',
        body: '# Rule\nDo the thing.',
      },
    });
    expect(created.statusCode).toBe(201);
    const skillId = created.json().id as string;

    // Two agents, linked through `agent_skills` — the join the aggregate reads.
    const agents = await pg.handle.db
      .insert(t.agents)
      .values([
        {
          workspaceId,
          name: 'usage-pin-a',
          provider: 'openai' as const,
          model: 'gpt-4.1',
          systemPrompt: 'Review.',
        },
        {
          workspaceId,
          name: 'usage-pin-b',
          provider: 'openai' as const,
          model: 'gpt-4.1',
          systemPrompt: 'Review.',
        },
      ])
      .returning();
    await pg.handle.db
      .insert(t.agentSkills)
      .values(agents.map((a) => ({ agentId: a.id, skillId, order: 0 })));

    const list = await app.inject({ method: 'GET', url: '/skills' });
    const mine = (list.json() as Array<{ id: string; used_by?: number }>).find(
      (s) => s.id === skillId,
    );
    expect(mine?.used_by).toBe(2);

    // Unlinking one agent moves the number. Asserting only the "2" would pass
    // against a hard-coded count as happily as against a real aggregate.
    await pg.handle.db.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agents[0]!.id));
    const after = await app.inject({ method: 'GET', url: '/skills' });
    const again = (after.json() as Array<{ id: string; used_by?: number }>).find(
      (s) => s.id === skillId,
    );
    expect(again?.used_by).toBe(1);

    await app.close();
  });
});

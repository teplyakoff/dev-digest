import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
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
} from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

/**
 * The Conventions Extractor end to end, with the model replaced by a fixture.
 *
 * What is being tested is everything AROUND the model: that a candidate citing a
 * file the prompt never carried is thrown away and counted, that the snippet is
 * read from the sample rather than accepted from the fixture, that a rejection
 * survives a re-scan, and that the merged skill contains the accepted set and
 * nothing else.
 *
 * The pure rules are covered without Docker in `conventions-samples.test.ts`,
 * `conventions-verify.test.ts` and `conventions-helpers.test.ts`.
 */

/** A small, plausible repo. Line numbers here are what the fixture cites. */
const CLONE_FILES: Record<string, string> = {
  'tsconfig.json': '{\n  "compilerOptions": {\n    "strict": true\n  }\n}\n',
  'package.json': '{\n  "name": "payments-api",\n  "version": "9.9.9",\n  "scripts": { "test": "vitest" }\n}\n',
  'src/api/users.ts': [
    'import { db } from "../lib/db";', // 1
    '', // 2
    'export async function getUser(id: string) {', // 3
    '  const user = await db.users.find(id);', // 4
    '  return ok(user);', // 5
    '}', // 6
  ].join('\n'),
  'src/lib/db.ts': [
    'import Redis from "ioredis";', // 1
    '', // 2
    'export const redis = new Redis(config.redisUrl);', // 3
  ].join('\n'),
};

const RANKED = ['src/api/users.ts', 'src/lib/db.ts'];

function repoIntelStub(ranked: string[], sha = 'a1b2c3d4e5f6'): RepoIntel {
  return {
    getConventionSamples: async () => ranked,
    getIndexState: async () => ({ lastIndexedSha: sha }),
  } as unknown as RepoIntel;
}

/** Shorthand for one entry in the model's answer. No snippet field exists. */
function proposed(over: Record<string, unknown> = {}) {
  return {
    category: 'error-handling',
    rule: 'Route handlers return ok() rather than throwing',
    evidence_path: 'src/api/users.ts',
    evidence_start_line: 3,
    evidence_end_line: 6,
    confidence: 0.9,
    ...over,
  };
}

d('conventions module', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
    const [repo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.workspaceId, workspaceId));
    repoId = repo!.id;
    // The seed leaves `clone_path` null; extraction needs one to read through.
    await pg.handle.db
      .update(t.repos)
      .set({ clonePath: '/tmp/devdigest-fixture-clone' })
      .where(eq(t.repos.id, repoId));
  });

  afterAll(async () => {
    await pg?.stop();
  });

  beforeEach(async () => {
    await pg.handle.db.delete(t.conventions).where(eq(t.conventions.repoId, repoId));
    await pg.handle.db.delete(t.conventionScans).where(eq(t.conventionScans.repoId, repoId));
  });

  function makeApp(opts: {
    candidates: Record<string, unknown>[];
    files?: Record<string, string>;
    ranked?: string[];
  }) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        sourceReader: new MockSourceReader(opts.files ?? CLONE_FILES),
        repoIntel: repoIntelStub(opts.ranked ?? RANKED),
        llm: {
          openrouter: new MockLLMProvider('openai', {
            structuredBySchema: { ConventionExtraction: { candidates: opts.candidates } },
          }),
        },
      },
    });
  }

  it('extracts, and reads the snippet from the sample rather than the model', async () => {
    const app = makeApp({ candidates: [proposed()] });
    const res = await (await app).inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
    });
    expect(res.statusCode).toBe(200);
    const view = res.json();

    expect(view.candidates).toHaveLength(1);
    // Byte-identical to lines 3-6 of the fixture file. The model supplied no
    // snippet at all — the schema has no field for one.
    expect(view.candidates[0].evidence_snippet).toBe(
      [
        'export async function getUser(id: string) {',
        '  const user = await db.users.find(id);',
        '  return ok(user);',
        '}',
      ].join('\n'),
    );
    expect(view.candidates[0].status).toBe('pending');
    expect(view.scan.kept).toBe(1);
    expect(view.scan.proposed).toBe(1);
    expect(view.scan.indexed_sha).toBe('a1b2c3d4e5f6');
  });

  it('samples the config allowlist, reducing package.json to its useful keys', async () => {
    const app = makeApp({ candidates: [] });
    const res = await (await app).inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
    });
    const scan = res.json().scan;
    expect(scan.config_files).toEqual(['tsconfig.json', 'package.json']);
    expect(scan.sampled_files).toEqual([
      'tsconfig.json',
      'package.json',
      'src/api/users.ts',
      'src/lib/db.ts',
    ]);
  });

  it('finds the configs of a repo that keeps them one level down', async () => {
    // The regression this exists for: the first live run against a repo of five
    // standalone packages sampled ZERO config files, because the allowlist only
    // looked at the root. The package dirs are derived from the ranked paths,
    // so nothing here lists a directory.
    const app = makeApp({
      candidates: [],
      ranked: ['server/src/api/users.ts', 'client/src/lib/api.ts'],
      files: {
        'server/tsconfig.json': '{ "compilerOptions": { "strict": true } }',
        'server/package.json': '{ "name": "api", "scripts": { "test": "vitest" } }',
        'client/tsconfig.json': '{ "compilerOptions": { "jsx": "preserve" } }',
        'server/src/api/users.ts': 'export const a = 1;',
        'client/src/lib/api.ts': 'export const b = 2;',
      },
    });
    const scan = (
      await (await app).inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` })
    ).json().scan;

    expect(scan.config_files).toEqual([
      'server/tsconfig.json',
      'server/package.json',
      'client/tsconfig.json',
    ]);
    // Reduced, not verbatim: `endsWith`, not a root-only `===` match.
    expect(scan.sampled_files).toContain('server/package.json');
  });

  it('drops an ungrounded candidate and RECORDS why, rather than swallowing it', async () => {
    const app = makeApp({
      candidates: [
        proposed(),
        proposed({ rule: 'A rule about a file nobody showed us', evidence_path: 'src/ghost.ts' }),
        proposed({ rule: 'A rule citing a line past the end', evidence_start_line: 99 }),
      ],
    });
    const view = (
      await (await app).inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` })
    ).json();

    expect(view.candidates).toHaveLength(1);
    expect(view.scan.proposed).toBe(3);
    expect(view.scan.kept).toBe(1);
    expect(view.scan.dropped).toEqual([
      { rule: 'A rule about a file nobody showed us', reason: 'file_not_sampled' },
      { rule: 'A rule citing a line past the end', reason: 'line_out_of_range' },
    ]);
  });

  it('accepts, rejects and edits a candidate', async () => {
    const app = await makeApp({
      candidates: [proposed(), proposed({ rule: 'Redis is reached through one singleton' })],
    });
    const view = (
      await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` })
    ).json();
    const [first, second] = view.candidates;

    const accepted = await app.inject({
      method: 'PATCH',
      url: `/conventions/${first.id}`,
      payload: { status: 'accepted' },
    });
    expect(accepted.json().status).toBe('accepted');

    const rejected = await app.inject({
      method: 'PATCH',
      url: `/conventions/${second.id}`,
      payload: { status: 'rejected' },
    });
    expect(rejected.json().status).toBe('rejected');

    const edited = await app.inject({
      method: 'PATCH',
      url: `/conventions/${first.id}`,
      payload: { rule: 'Route handlers always return ok() and never throw' },
    });
    expect(edited.json().rule).toBe('Route handlers always return ok() and never throw');
    // Editing the text must not quietly un-accept it.
    expect(edited.json().status).toBe('accepted');
  });

  it('carries a rejection across a re-scan, so it is not re-proposed forever', async () => {
    const app = await makeApp({ candidates: [proposed(), proposed({ rule: 'A rule to reject' })] });
    const first = (
      await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` })
    ).json();
    const toReject = first.candidates.find((c: { rule: string }) => c.rule === 'A rule to reject');
    await app.inject({
      method: 'PATCH',
      url: `/conventions/${toReject.id}`,
      payload: { status: 'rejected' },
    });

    const second = (
      await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` })
    ).json();
    const again = second.candidates.find((c: { rule: string }) => c.rule === 'A rule to reject');
    expect(again.status).toBe('rejected');
    // The untouched one comes back pending, not silently accepted.
    expect(
      second.candidates.find((c: { rule: string }) => c.rule === proposed().rule).status,
    ).toBe('pending');
  });

  it('refuses a skill draft until something is accepted', async () => {
    const app = await makeApp({ candidates: [proposed()] });
    await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/conventions/skill-draft`,
    });
    expect(res.statusCode).toBe(422);
  });

  it('builds the draft from the accepted set ONLY', async () => {
    const app = await makeApp({
      candidates: [proposed(), proposed({ rule: 'A rejected rule about caching' })],
    });
    const view = (
      await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` })
    ).json();
    const keep = view.candidates.find((c: { rule: string }) => c.rule === proposed().rule);
    const drop = view.candidates.find((c: { rule: string }) => c.rule !== proposed().rule);

    await app.inject({
      method: 'PATCH',
      url: `/conventions/${keep.id}`,
      payload: { status: 'accepted' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/conventions/${drop.id}`,
      payload: { status: 'rejected' },
    });

    const draft = (
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions/skill-draft` })
    ).json();
    expect(draft.name).toBe('repo-conventions');
    expect(draft.body).toContain(proposed().rule);
    // The claim the feature is judged on.
    expect(draft.body).not.toContain('A rejected rule about caching');
    expect(draft.candidate_ids).toEqual([keep.id]);
  });

  it('creates the skill as `extracted` and stamps only the accepted candidates', async () => {
    const app = await makeApp({
      candidates: [proposed(), proposed({ rule: 'A rejected rule about caching' })],
    });
    const view = (
      await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` })
    ).json();
    const keep = view.candidates.find((c: { rule: string }) => c.rule === proposed().rule);
    const drop = view.candidates.find((c: { rule: string }) => c.rule !== proposed().rule);
    await app.inject({
      method: 'PATCH',
      url: `/conventions/${keep.id}`,
      payload: { status: 'accepted' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/conventions/${drop.id}`,
      payload: { status: 'rejected' },
    });

    const draft = (
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions/skill-draft` })
    ).json();
    const created = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/skill`,
      payload: { ...draft, name: `conv-${Math.random().toString(36).slice(2, 8)}` },
    });
    expect(created.statusCode).toBe(201);
    const skill = created.json();
    expect(skill.source).toBe('extracted');
    expect(skill.version).toBe(1);

    // v1 snapshot and the stamp are in the same transaction as the insert.
    const versions = await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` });
    expect(versions.json()).toHaveLength(1);

    const rows = await pg.handle.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.repoId, repoId)));
    expect(rows.find((r) => r.id === keep.id)!.skillId).toBe(skill.id);
    expect(rows.find((r) => r.id === drop.id)!.skillId).toBeNull();
  });

  it('answers 409 not_indexed rather than sampling whatever it can find', async () => {
    const app = await makeApp({ candidates: [proposed()], ranked: [] });
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details).toMatchObject({ code: 'not_indexed' });

    // And it writes NO scan row — a scan that sampled nothing is not a scan.
    const scans = await pg.handle.db
      .select()
      .from(t.conventionScans)
      .where(eq(t.conventionScans.repoId, repoId));
    expect(scans).toHaveLength(0);
  });

  it('reads back an empty view before the first scan', async () => {
    const app = await makeApp({ candidates: [] });
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ scan: null, candidates: [] });
  });
});

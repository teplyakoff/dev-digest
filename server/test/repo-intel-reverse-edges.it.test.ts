/**
 * `getReverseEdges` against a real `file_edges` table — the SQL half of Blast
 * Radius's dependency walk.
 *
 * WHY THIS NEEDS POSTGRES when `repo-intel-dependents.test.ts` already covers
 * the traversal: that test patches `svc.repo` and exercises the BFS over a stub,
 * so it proves the walking logic and nothing about the query. The query is where
 * the one mistake that matters lives — `file_edges` is written
 * `from_file IMPORTS to_file`, so dependents are found by matching `to_file`,
 * and a version that matched `from_file` would return the changed file's own
 * dependencies. That result is non-empty, plausible, and exactly backwards; no
 * stub can catch it, because a stub is written by whoever already believes the
 * direction is right.
 *
 * It also pins the two things a hand-written `inArray` gets wrong: an empty
 * input must not become `IN ()`, and rows belonging to another repo must not
 * come back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { RepoIntelRepository } from '../src/modules/repo-intel/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('getReverseEdges: who imports these files', () => {
  let pg: PgFixture;
  let repoId: string;
  let otherRepoId: string;
  let repo: RepoIntelRepository;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    const [r] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws!.id, owner: 'acme', name: 'graph', fullName: 'acme/graph' })
      .returning();
    const [other] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws!.id, owner: 'acme', name: 'other', fullName: 'acme/other' })
      .returning();
    repoId = r!.id;
    otherRepoId = other!.id;
    repo = new RepoIntelRepository(pg.handle.db);

    // routes.ts → service.ts → helpers.ts → util.ts, the shape of the demo PR:
    // a shared helper, its caller, and the route file two hops out.
    await repo.replaceEdges(repoId, [
      { fromFile: 'service.ts', toFile: 'helpers.ts' },
      { fromFile: 'routes.ts', toFile: 'service.ts' },
      { fromFile: 'helpers.ts', toFile: 'util.ts' },
      { fromFile: 'unrelated.ts', toFile: 'somewhere.ts' },
    ]);
    // Same edge text in a different repo — must never leak across.
    await repo.replaceEdges(otherRepoId, [{ fromFile: 'intruder.ts', toFile: 'helpers.ts' }]);
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('returns the importers of a file, not the files it imports', async () => {
    const rows = await repo.getReverseEdges(repoId, ['helpers.ts']);
    expect(rows.map((r) => r.fromFile)).toEqual(['service.ts']);
    // `util.ts` is helpers.ts's own dependency. A query matching `from_file`
    // would return it here, and the answer would look perfectly reasonable.
    expect(rows.map((r) => r.fromFile)).not.toContain('util.ts');
  });

  it('carries the edge it arrived on, so a caller can attribute the hop', async () => {
    const rows = await repo.getReverseEdges(repoId, ['helpers.ts']);
    expect(rows[0]).toEqual({ fromFile: 'service.ts', toFile: 'helpers.ts' });
  });

  it('takes a whole frontier in one query', async () => {
    const rows = await repo.getReverseEdges(repoId, ['helpers.ts', 'service.ts']);
    expect(rows.map((r) => r.fromFile).sort()).toEqual(['routes.ts', 'service.ts']);
  });

  it('is scoped to its repo', async () => {
    const rows = await repo.getReverseEdges(repoId, ['helpers.ts']);
    expect(rows.map((r) => r.fromFile)).not.toContain('intruder.ts');
    // …and the other repo sees only its own.
    const theirs = await repo.getReverseEdges(otherRepoId, ['helpers.ts']);
    expect(theirs.map((r) => r.fromFile)).toEqual(['intruder.ts']);
  });

  it('returns [] for an empty frontier without issuing an IN () query', async () => {
    await expect(repo.getReverseEdges(repoId, [])).resolves.toEqual([]);
  });

  it('returns [] for a file nothing imports', async () => {
    await expect(repo.getReverseEdges(repoId, ['routes.ts'])).resolves.toEqual([]);
  });
});

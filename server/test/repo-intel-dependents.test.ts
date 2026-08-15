import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import type { IndexerEdgeRow, IndexerFileFactsRow } from '../src/modules/repo-intel/repository.js';

/**
 * `RepoIntel.getDependents` — the reverse import-graph walk Blast Radius is
 * built on, and `tryPersistentBlast`'s per-symbol caller cap.
 *
 * Hermetic: no Postgres, no clone. The service's `repo` is patched exactly as
 * `repo-intel-facade-degraded.test.ts` does, so what is under test is the
 * traversal, not Drizzle.
 *
 * The one thing these tests exist to stop is a graph walked the WRONG WAY.
 * `file_edges` is written `fromFile IMPORTS toFile`, so dependents are found by
 * matching `toFile` — walk `fromFile` instead and you get the changed file's
 * own dependencies, which renders as a perfectly plausible list of the wrong
 * files. Nothing else in the stack would notice: it type-checks, it is
 * non-empty, and it is confidently wrong.
 */

interface RepoStub {
  edges: IndexerEdgeRow[];
  facts?: IndexerFileFactsRow[];
  reverseCalls?: string[][];
}

function build(stub: RepoStub, flag = true): RepoIntelService {
  const container = { config: { repoIntelEnabled: flag }, db: {} as never } as never;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    getReverseEdges: async (_repoId: string, toFiles: string[]) => {
      stub.reverseCalls?.push([...toFiles]);
      return stub.edges.filter((e) => toFiles.includes(e.toFile));
    },
    getFileFacts: async (_repoId: string, files: string[]) =>
      (stub.facts ?? []).filter((f) => files.includes(f.filePath)),
  };
  return svc;
}

describe('getDependents — direction', () => {
  it('returns the files that IMPORT the changed file, not the ones it imports', async () => {
    // helpers.ts is imported by service.ts; helpers.ts itself imports util.ts.
    const svc = build({
      edges: [
        { fromFile: 'service.ts', toFile: 'helpers.ts' },
        { fromFile: 'helpers.ts', toFile: 'util.ts' },
      ],
    });
    const out = await svc.getDependents('r1', ['helpers.ts']);
    expect(out.map((d) => d.file)).toEqual(['service.ts']);
    // The failure this asserts against: 'util.ts' is helpers.ts's dependency,
    // and it must never appear in a list of its dependents.
    expect(out.map((d) => d.file)).not.toContain('util.ts');
  });
});

describe('getDependents — traversal', () => {
  it('walks two hops and labels each with its depth and originating changed file', async () => {
    const svc = build({
      edges: [
        { fromFile: 'service.ts', toFile: 'helpers.ts' },
        { fromFile: 'routes.ts', toFile: 'service.ts' },
      ],
    });
    const out = await svc.getDependents('r1', ['helpers.ts']);
    expect(out).toEqual([
      { file: 'service.ts', depth: 1, via: 'helpers.ts', endpoints: [], crons: [] },
      // depth 2 keeps the CHANGED file as `via`, not its depth-1 parent.
      { file: 'routes.ts', depth: 2, via: 'helpers.ts', endpoints: [], crons: [] },
    ]);
  });

  it('stops at the requested depth', async () => {
    const svc = build({
      edges: [
        { fromFile: 'b.ts', toFile: 'a.ts' },
        { fromFile: 'c.ts', toFile: 'b.ts' },
        { fromFile: 'd.ts', toFile: 'c.ts' },
      ],
    });
    await expect(svc.getDependents('r1', ['a.ts'], 1)).resolves.toHaveLength(1);
    await expect(svc.getDependents('r1', ['a.ts'], 2)).resolves.toHaveLength(2);
    // Default is BFS_DEPTH (2), so d.ts is out of reach without an explicit ask.
    const deflt = await svc.getDependents('r1', ['a.ts']);
    expect(deflt.map((d) => d.file)).toEqual(['b.ts', 'c.ts']);
  });

  it('issues one query per hop, not one per file', async () => {
    const reverseCalls: string[][] = [];
    const svc = build({
      edges: [
        { fromFile: 'x.ts', toFile: 'a.ts' },
        { fromFile: 'y.ts', toFile: 'b.ts' },
        { fromFile: 'z.ts', toFile: 'x.ts' },
      ],
      reverseCalls,
    });
    await svc.getDependents('r1', ['a.ts', 'b.ts']);
    expect(reverseCalls).toEqual([
      ['a.ts', 'b.ts'],
      ['x.ts', 'y.ts'],
    ]);
  });

  it('terminates on a cycle and never reports a changed file as its own dependent', async () => {
    const svc = build({
      edges: [
        { fromFile: 'b.ts', toFile: 'a.ts' },
        { fromFile: 'a.ts', toFile: 'b.ts' },
      ],
    });
    const out = await svc.getDependents('r1', ['a.ts'], 5);
    expect(out.map((d) => d.file)).toEqual(['b.ts']);
  });

  it('deduplicates a file reachable by more than one path, keeping the shallower hop', async () => {
    const svc = build({
      edges: [
        { fromFile: 'shared.ts', toFile: 'a.ts' },
        { fromFile: 'mid.ts', toFile: 'a.ts' },
        { fromFile: 'shared.ts', toFile: 'mid.ts' },
      ],
    });
    const out = await svc.getDependents('r1', ['a.ts']);
    expect(out.filter((d) => d.file === 'shared.ts')).toHaveLength(1);
    expect(out.find((d) => d.file === 'shared.ts')?.depth).toBe(1);
  });
});

describe('getDependents — facts and degraded contract', () => {
  it('joins endpoints and crons, defaulting the files that have no facts row', async () => {
    const svc = build({
      edges: [
        { fromFile: 'routes.ts', toFile: 'a.ts' },
        { fromFile: 'quiet.ts', toFile: 'a.ts' },
      ],
      facts: [{ filePath: 'routes.ts', endpoints: ['GET /repos'], crons: ['nightly'] }],
    });
    const out = await svc.getDependents('r1', ['a.ts']);
    expect(out.find((d) => d.file === 'routes.ts')).toMatchObject({
      endpoints: ['GET /repos'],
      crons: ['nightly'],
    });
    // No `file_facts` row is the COMMON case, not an error: the pipeline only
    // persists rows that actually have an endpoint or a cron.
    expect(out.find((d) => d.file === 'quiet.ts')).toMatchObject({ endpoints: [], crons: [] });
  });

  it('returns [] when the flag is off, when there are no files, and when depth < 1', async () => {
    const edges = [{ fromFile: 'b.ts', toFile: 'a.ts' }];
    await expect(build({ edges }, false).getDependents('r1', ['a.ts'])).resolves.toEqual([]);
    await expect(build({ edges }).getDependents('r1', [])).resolves.toEqual([]);
    await expect(build({ edges }).getDependents('r1', ['a.ts'], 0)).resolves.toEqual([]);
  });
});

/**
 * The cap `MAX_CALLERS_PER_SYMBOL` is documented as being "per changed symbol"
 * and used to be applied to the flat list of every symbol's callers. The
 * difference only shows up on a PR that changes more than one symbol, which is
 * most of them.
 */
describe('tryPersistentBlast — caller cap', () => {
  function blastService(callerCount: number, symbols: string[]): RepoIntelService {
    const container = { config: { repoIntelEnabled: true }, db: {} as never } as never;
    const svc = new RepoIntelService(container);
    const declRows = symbols.map((name) => ({
      path: 'helpers.ts',
      name,
      kind: 'function',
      line: 1,
      endLine: 2,
      exported: true,
      signature: null,
    }));
    // Every symbol gets `callerCount` callers, each in its own file so the
    // (file, symbol, viaSymbol) dedup key never collapses them.
    const callers = symbols.flatMap((name, s) =>
      Array.from({ length: callerCount }, (_, i) => ({
        fromPath: `caller-${s}-${i}.ts`,
        toSymbol: name,
        line: 10 + i,
        rank: callerCount - i,
      })),
    );
    (svc as unknown as { repo: Record<string, unknown> }).repo = {
      tryGetIndexState: async () => ({ status: 'full' }),
      getSymbolRows: async (_r: string, paths: string[]) =>
        paths.includes('helpers.ts') ? declRows : [],
      getResolvedCallers: async () => callers,
      getFileFacts: async () => [],
    };
    return svc;
  }

  it('keeps 20 callers for EACH changed symbol, not 20 in total', async () => {
    const svc = blastService(25, ['alpha', 'beta']);
    const res = await svc.getBlastRadius('r1', ['helpers.ts']);
    expect(res.degraded).toBe(false);
    expect(res.callers).toHaveLength(40);
    expect(res.callers.filter((c) => c.viaSymbol === 'alpha')).toHaveLength(20);
    // The regression: with a flat slice, `beta` came back with zero callers and
    // the UI reported "nothing calls this".
    expect(res.callers.filter((c) => c.viaSymbol === 'beta')).toHaveLength(20);
  });

  it('drops the lowest-ranked callers, not an arbitrary 20', async () => {
    const svc = blastService(25, ['alpha']);
    const res = await svc.getBlastRadius('r1', ['helpers.ts']);
    const ranks = res.callers.map((c) => c.rank);
    expect(ranks[0]).toBe(25);
    expect(Math.min(...ranks)).toBe(6);
  });
});

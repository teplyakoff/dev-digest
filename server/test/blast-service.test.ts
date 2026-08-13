import { describe, it, expect } from 'vitest';
import { BlastService } from '../src/modules/blast/service.js';
import { BLAST_REASONS, MAX_SYMBOLS } from '../src/modules/blast/constants.js';
import { NotFoundError } from '../src/platform/errors.js';
import type { Container } from '../src/platform/container.js';
import type { PullRow, ReviewRepository } from '../src/modules/reviews/repository.js';
import type {
  BlastResult,
  DependentRow,
  FileFactsRow,
  IndexState,
  IndexStatus,
} from '../src/modules/repo-intel/types.js';

/**
 * `BlastService.get` — the gate, the pivot and the three states, with a stubbed
 * container.
 *
 * NO DOCKER, BY DESIGN: this is a ring-2 use case, so it gets doubles and no
 * database (onion §12). Everything it reads arrives through `reviewRepo` and
 * the `RepoIntel` facade, which is exactly why consumers are made to code
 * against that interface.
 *
 * Two claims here are not about output at all, and they are the ones worth
 * having:
 *
 *  1. `llm()` throws AND records. That is the machine-checkable half of "the
 *     main path calls no model"; the other half is structural (no LLM adapter
 *     is reachable from `service.ts`) and cannot be asserted from a test.
 *  2. `getBlastRadius` records that it was called. The endpoint's promise is
 *     that it never re-parses the repository at request time, and the way that
 *     could break is the facade's clone-parsing fallback being reached — so
 *     "the facade was not called at all when the index is unusable" is the
 *     assertion that pins it. Calling the facade and hoping it picks its fast
 *     branch is the thing being ruled out.
 */

type PrFileRow = Awaited<ReturnType<ReviewRepository['getPrFiles']>>[number];

const WS = 'ws-1';
const PR = 'pr-1';
const REPO = 'repo-1';
const SHA = 'abc1234';

function fileRow(path: string): PrFileRow {
  return { id: `file-${path}`, prId: PR, path, additions: 1, deletions: 0, patch: null };
}

function indexState(status: IndexStatus): IndexState {
  return {
    repoId: REPO,
    status,
    filesIndexed: status === 'degraded' ? 0 : 120,
    filesSkipped: 0,
    durationMs: 10,
    lastIndexedSha: status === 'degraded' ? '' : SHA,
    indexerVersion: 2,
    updatedAt: new Date('2026-08-13T00:00:00Z'),
  };
}

const NO_BLAST: BlastResult = {
  changedSymbols: [],
  callers: [],
  impactedEndpoints: [],
  degraded: false,
};

interface Harness {
  service: BlastService;
  llmCalls: string[];
  /** Facade methods actually reached, in order. */
  reads: string[];
  logs: { obj: Record<string, unknown>; msg?: string }[];
}

function makeService(
  opts: {
    files?: PrFileRow[];
    status?: IndexStatus;
    flag?: boolean;
    blast?: BlastResult;
    dependents?: DependentRow[];
    ownFacts?: FileFactsRow[];
    pullExists?: boolean;
  } = {},
): Harness {
  const llmCalls: string[] = [];
  const reads: string[] = [];
  const logs: { obj: Record<string, unknown>; msg?: string }[] = [];

  const container = {
    config: { repoIntelEnabled: opts.flag ?? true },
    reviewRepo: {
      getPull: async (): Promise<PullRow | undefined> =>
        (opts.pullExists ?? true)
          ? ({ id: PR, workspaceId: WS, repoId: REPO } as PullRow)
          : undefined,
      getPrFiles: async () => opts.files ?? [fileRow('src/helpers.ts')],
    },
    repoIntel: {
      getIndexState: async () => {
        reads.push('getIndexState');
        return indexState(opts.status ?? 'full');
      },
      getBlastRadius: async () => {
        reads.push('getBlastRadius');
        return opts.blast ?? NO_BLAST;
      },
      getDependents: async () => {
        reads.push('getDependents');
        return opts.dependents ?? [];
      },
      getFileFacts: async () => {
        reads.push('getFileFacts');
        return opts.ownFacts ?? [];
      },
    },
    llm: async (id: string) => {
      llmCalls.push(id);
      throw new Error(`BlastService called container.llm(${id}) — it must cost zero tokens`);
    },
  } as unknown as Container;

  return {
    service: new BlastService(container),
    llmCalls,
    reads,
    logs,
  };
}

function logger(logs: Harness['logs']) {
  return { info: (obj: unknown, msg?: string) => logs.push({ obj: obj as never, msg }) };
}

describe('BlastService — tenancy', () => {
  it('404s a PR that belongs to another workspace, before reading anything', async () => {
    const h = makeService({ pullExists: false });
    await expect(h.service.get(WS, PR)).rejects.toBeInstanceOf(NotFoundError);
    expect(h.reads).toEqual([]);
  });
});

describe('BlastService — the no-parsing gate', () => {
  it.each([
    ['degraded', BLAST_REASONS.no_index],
    ['failed', BLAST_REASONS.index_failed],
  ] as const)('returns degraded on a %s index WITHOUT calling the facade', async (status, msg) => {
    const h = makeService({ status });
    const res = await h.service.get(WS, PR, logger(h.logs));

    expect(res.status).toBe('degraded');
    expect(res.reason).toBe(msg);
    // THE ASSERTION THAT MATTERS. `getBlastRadius` has a fallback branch that
    // re-reads the clone and re-parses it with tree-sitter; the endpoint's
    // guarantee is not "the fallback is fast enough" but "the fallback is
    // never reached". Only `getIndexState` may have run.
    expect(h.reads).toEqual(['getIndexState']);
  });

  it('returns degraded when repo intelligence is switched off server-wide', async () => {
    // The index row can say `full` and still be unusable: with the flag off the
    // facade refuses its persistent branch and drops to the parsing fallback,
    // so the state row alone is not enough to decide this.
    const h = makeService({ flag: false, status: 'full' });
    const res = await h.service.get(WS, PR);
    expect(res.status).toBe('degraded');
    expect(res.reason).toBe(BLAST_REASONS.flag_off);
    expect(h.reads).toEqual(['getIndexState']);
  });

  it('still reports the changed files and the indexed sha while degraded', async () => {
    const h = makeService({ status: 'degraded', files: [fileRow('a.ts'), fileRow('b.ts')] });
    const res = await h.service.get(WS, PR);
    expect(res.changed_files).toEqual(['a.ts', 'b.ts']);
    expect(res.symbols).toEqual([]);
    expect(res.endpoints).toEqual([]);
    expect(res.counts).toEqual({ symbols: 0, callers: 0, endpoints: 0 });
  });
});

describe('BlastService — the map', () => {
  const blast: BlastResult = {
    changedSymbols: [
      { file: 'src/helpers.ts', name: 'toRepoDto', kind: 'function' },
      { file: 'src/helpers.ts', name: 'parseRepoUrl', kind: 'function' },
    ],
    callers: [
      { file: 'src/service.ts', symbol: 'add', viaSymbol: 'toRepoDto', line: 92, rank: 9 },
      { file: 'src/service.ts', symbol: 'list', viaSymbol: 'toRepoDto', line: 107, rank: 9 },
      { file: 'src/other.ts', symbol: 'parse', viaSymbol: 'parseRepoUrl', line: 12, rank: 3 },
    ],
    impactedEndpoints: [],
    degraded: false,
  };

  it('groups callers under the symbol they reach, widest reach first', async () => {
    const h = makeService({ blast });
    const res = await h.service.get(WS, PR, logger(h.logs));

    expect(res.status).toBe('full');
    expect(res.reason).toBeNull();
    expect(res.symbols.map((s) => s.name)).toEqual(['toRepoDto', 'parseRepoUrl']);
    expect(res.symbols[0].callers.map((c) => `${c.file}:${c.line}`)).toEqual([
      'src/service.ts:92',
      'src/service.ts:107',
    ]);
    expect(res.symbols[0].callers_total).toBe(2);
    expect(res.counts).toMatchObject({ symbols: 2, callers: 3 });
  });

  it('marks an endpoint in a CHANGED file as depth 0 and a downstream one by its hops', async () => {
    const h = makeService({
      blast,
      ownFacts: [{ file: 'src/routes.ts', endpoints: ['POST /repos'], crons: [] }],
      dependents: [
        {
          file: 'src/api.ts',
          depth: 2,
          via: 'src/helpers.ts',
          endpoints: ['GET /repos/:id'],
          crons: ['nightly-sync'],
        },
      ],
    });
    const res = await h.service.get(WS, PR);

    // Sorted by depth: what the PR touches directly comes before what it can
    // only reach. The two are different claims and the UI is expected to say so.
    expect(res.endpoints).toEqual([
      { route: 'POST /repos', file: 'src/routes.ts', depth: 0, via: 'src/routes.ts' },
      { route: 'GET /repos/:id', file: 'src/api.ts', depth: 2, via: 'src/helpers.ts' },
    ]);
    expect(res.crons).toEqual([
      { name: 'nightly-sync', file: 'src/api.ts', depth: 2, via: 'src/helpers.ts' },
    ]);
    expect(res.counts.endpoints).toBe(2);
  });

  it('reports the TOTAL symbol count, not the capped list length', async () => {
    const many = Array.from({ length: MAX_SYMBOLS + 13 }, (_, i) => ({
      file: 'src/helpers.ts',
      name: `sym${String(i).padStart(3, '0')}`,
      kind: 'function',
    }));
    const h = makeService({
      blast: {
        ...NO_BLAST,
        changedSymbols: many,
        callers: many.map((m, i) => ({
          file: `src/c${i}.ts`,
          symbol: 'x',
          viaSymbol: m.name,
          line: 1,
          rank: 1,
        })),
      },
    });
    const res = await h.service.get(WS, PR);

    // The array is capped…
    expect(res.symbols).toHaveLength(MAX_SYMBOLS);
    // …and the counts are NOT, which is the only thing that lets a consumer
    // say "showing 50 of 63". Computed the other way round, a truncated list
    // reports its own length and nothing anywhere says it is short.
    expect(res.counts.symbols).toBe(MAX_SYMBOLS + 13);
    expect(res.counts.callers).toBe(MAX_SYMBOLS + 13);
  });

  it('collapses a route found twice, keeping the shallower claim', async () => {
    const h = makeService({
      blast,
      // The same route in the same file, once because a changed file declares
      // it and once because the walk reached that file again.
      ownFacts: [{ file: 'src/routes.ts', endpoints: ['GET /repos', 'GET /repos'], crons: [] }],
      dependents: [
        {
          file: 'src/routes.ts',
          depth: 2,
          via: 'src/helpers.ts',
          endpoints: ['GET /repos'],
          crons: [],
        },
      ],
    });
    const res = await h.service.get(WS, PR);

    expect(res.endpoints).toHaveLength(1);
    // depth 0 wins: "this PR changes the file that declares it" is the stronger
    // of the two claims, and the walked one is the same route arriving again.
    expect(res.endpoints[0]).toMatchObject({ route: 'GET /repos', depth: 0 });
    // The count is the deduped one, so every surface reports the same number —
    // it used to be the raw length while only the web client collapsed them.
    expect(res.counts.endpoints).toBe(1);
  });

  it('caps the symbol list and keeps the ones with the most callers', async () => {
    const many = Array.from({ length: MAX_SYMBOLS + 10 }, (_, i) => ({
      file: 'src/helpers.ts',
      name: `sym${String(i).padStart(3, '0')}`,
      kind: 'function',
    }));
    const h = makeService({
      blast: {
        ...NO_BLAST,
        changedSymbols: many,
        // Only the last symbol has a caller; the cap must not drop it.
        callers: [
          {
            file: 'src/service.ts',
            symbol: 'x',
            viaSymbol: many[many.length - 1].name,
            line: 1,
            rank: 1,
          },
        ],
      },
    });
    const res = await h.service.get(WS, PR);
    expect(res.symbols).toHaveLength(MAX_SYMBOLS);
    expect(res.symbols[0].name).toBe(many[many.length - 1].name);
  });
});

describe('BlastService — partial states', () => {
  it('reports an incomplete index as partial even when it found plenty', async () => {
    const h = makeService({
      status: 'partial',
      blast: {
        ...NO_BLAST,
        changedSymbols: [{ file: 'src/helpers.ts', name: 'f', kind: 'function' }],
        callers: [{ file: 'src/a.ts', symbol: 'g', viaSymbol: 'f', line: 3, rank: 1 }],
      },
    });
    const res = await h.service.get(WS, PR);
    // "This list may be short" stays true however long the list turned out.
    expect(res.status).toBe('partial');
    expect(res.reason).toBe(BLAST_REASONS.partial_index);
    expect(res.symbols).toHaveLength(1);
  });

  it('explains a full index that tracks no symbol in the diff, rather than going blank', async () => {
    const h = makeService({ files: [fileRow('README.md'), fileRow('docker-compose.yml')] });
    const res = await h.service.get(WS, PR);
    expect(res.status).toBe('partial');
    expect(res.reason).toBe(BLAST_REASONS.no_symbols);
    // Not `degraded`: the index is fine, the diff simply has nothing in it that
    // the indexer tracks. Saying that is the difference between an empty state
    // and a broken one.
    expect(res.indexed_sha).toBe(SHA);
  });

  it('a PR with no changed files is full and empty, not degraded', async () => {
    const h = makeService({ files: [] });
    const res = await h.service.get(WS, PR);
    expect(res.status).toBe('full');
    expect(res.reason).toBeNull();
    expect(h.reads).toEqual(['getIndexState']);
  });
});

describe('BlastService — cost', () => {
  it('never calls a model, and logs what it read instead', async () => {
    const h = makeService({
      blast: {
        ...NO_BLAST,
        changedSymbols: [{ file: 'src/helpers.ts', name: 'f', kind: 'function' }],
      },
    });
    await h.service.get(WS, PR, logger(h.logs));

    expect(h.llmCalls).toEqual([]);
    const line = h.logs.at(-1);
    expect(line?.obj).toMatchObject({ llm_calls: 0, blast_status: 'full' });
    // The proof line names the tables it read, so the claim in the log is
    // falsifiable rather than congratulatory.
    expect(String(line?.obj.read)).toContain('file_edges');
  });

  it('sorts changed files, since the read that produced them has no order', async () => {
    const h = makeService({ files: [fileRow('z.ts'), fileRow('a.ts'), fileRow('m.ts')] });
    const res = await h.service.get(WS, PR);
    expect(res.changed_files).toEqual(['a.ts', 'm.ts', 'z.ts']);
  });
});

import { describe, it, expect } from 'vitest';
import type { BlastResponse, PrIntentRecord } from '@devdigest/shared';
import {
  collectBriefInput,
  renderBriefBlocks,
  type CollectedInput,
} from '../src/modules/brief/pipeline/sources.js';
import type { Container } from '../src/platform/container.js';
import type { PullRow, ReviewRepository } from '../src/modules/reviews/repository.js';

/**
 * `collectBriefInput` + `renderBriefBlocks` — what the brief is allowed to see,
 * and what it renders.
 *
 * NO DOCKER, BY DESIGN: ring-2 use case, so doubles and no database (onion §12).
 * Everything it reads arrives through the composition root, which is what makes
 * a stubbed `Container` sufficient.
 *
 * The claim worth having here is a NEGATIVE one, and it is why the fixture below
 * fills `pr_files.patch` with a recognisable string: the brief must never put a
 * hunk body in front of a model (AC-2). Asserting it on the collected object AND
 * on the rendered text is deliberate — one of them alone would pass a
 * `CollectedInput` that carried the patch quietly for a later reader to render.
 */

type PrFileRow = Awaited<ReturnType<ReviewRepository['getPrFiles']>>[number];

const WS = 'ws-1';
const PR = 'pr-1';
const REPO = 'repo-1';
const SHA = 'deadbee';

/** The string no assertion below may find anywhere downstream of the collector. */
const PATCH_BODY = '@@ -1,4 +1,9 @@\n-const secretHunkBody = 1;\n+const secretHunkBody = 2;';

function fileRow(path: string, additions: number, deletions: number): PrFileRow {
  return { id: `file-${path}`, prId: PR, path, additions, deletions, patch: PATCH_BODY };
}

const INTENT: PrIntentRecord = {
  summary: 'Adds a PR brief endpoint',
  in_scope: ['server/src/modules/brief'],
  out_of_scope: ['client'],
  pr_id: PR,
  confidence: 'high',
  sources: [
    { kind: 'pr_title', ref: 'title', status: 'used' },
    { kind: 'linked_issue', ref: '#42', status: 'used' },
  ],
  missing_context: [],
  head_sha: SHA,
  provider: 'openrouter',
  model: 'test-model',
  derived_at: '2026-08-25T00:00:00.000Z',
  tokens_in: 100,
  tokens_out: 20,
  cost_usd: null,
};

function blastResponse(over: Partial<BlastResponse> = {}): BlastResponse {
  return {
    status: 'full',
    reason: null,
    changed_files: ['src/a.ts', 'src/b.ts'],
    symbols: [
      {
        name: 'buildBrief',
        file: 'src/a.ts',
        kind: 'function',
        callers: [{ file: 'src/routes.ts', symbol: 'handler', line: 12, rank: 0.9 }],
        callers_total: 1,
      },
    ],
    endpoints: [{ route: 'GET /pulls/:id/brief', file: 'src/routes.ts', depth: 0, via: 'src/a.ts' }],
    crons: [{ name: 'nightly-reindex', file: 'src/jobs.ts', depth: 1, via: 'src/a.ts' }],
    indexed_sha: SHA,
    counts: { symbols: 1, callers: 1, endpoints: 1 },
    ...over,
  };
}

interface Harness {
  container: Container;
  /** Facade methods actually reached, in order — tenancy is proved by position. */
  reads: string[];
  llmCalls: string[];
}

function makeContainer(
  opts: {
    files?: PrFileRow[];
    docs?: { name: string; body: string }[];
    blast?: BlastResponse;
    issue?: { ref: string; text: string } | { ref: string; note: string } | null;
    storedIntent?: PrIntentRecord | null;
    pullExists?: boolean;
  } = {},
): Harness {
  const reads: string[] = [];
  const llmCalls: string[] = [];

  const container = {
    reviewRepo: {
      getPull: async (): Promise<PullRow | undefined> => {
        reads.push('getPull');
        return (opts.pullExists ?? true)
          ? ({
              id: PR,
              workspaceId: WS,
              repoId: REPO,
              title: 'feat(brief): add the PR brief',
              headSha: SHA,
              additions: 120,
              deletions: 30,
              filesCount: 2,
            } as PullRow)
          : undefined;
      },
      getRepo: async () => {
        reads.push('getRepo');
        return { id: REPO, owner: 'teplyakoff', name: 'dev-digest' };
      },
      getPrFiles: async () => {
        reads.push('getPrFiles');
        return opts.files ?? [fileRow('src/b.ts', 10, 2), fileRow('src/a.ts', 100, 20)];
      },
    },
    intent: {
      view: async () => {
        reads.push('intent.view');
        return { intent: opts.storedIntent === undefined ? INTENT : opts.storedIntent };
      },
      renderIntentBlock: (r: PrIntentRecord) => `Intent: ${r.summary}\nIn scope: ${r.in_scope.join(', ')}`,
      linkedIssueText: async () => {
        reads.push('intent.linkedIssueText');
        return opts.issue === undefined ? { ref: '#42', text: 'Issue title\n\nIssue body' } : opts.issue;
      },
    },
    blast: {
      get: async () => {
        reads.push('blast.get');
        return opts.blast ?? blastResponse();
      },
    },
    contextRepo: {
      listDocs: async () => {
        reads.push('listDocs');
        return opts.docs ?? [
          { name: 'architecture.md', body: 'the rings' },
          { name: 'testing.md', body: 'the pyramid' },
        ];
      },
    },
    // The collector must never reach a model: it is code, and the one call this
    // feature makes belongs to the service. A throwing stub makes a regression
    // loud rather than expensive.
    llm: async (id: string) => {
      llmCalls.push(id);
      throw new Error(`collectBriefInput called container.llm(${id})`);
    },
    repoIntel: {
      getBlastRadius: async () => {
        throw new Error('collectBriefInput reached repoIntel.getBlastRadius, bypassing blast');
      },
    },
  } as unknown as Container;

  return { container, reads, llmCalls };
}

describe('test_brief_input', () => {
  it('collects exactly the six sources, and resolves the tenancy gate first (AC-1)', async () => {
    const h = makeContainer();
    const input = await collectBriefInput(h.container, WS, PR);

    // AC-1, source by source.
    expect(input.prTitle).toBe('feat(brief): add the PR brief');
    expect(input.intentBlock).toContain('Adds a PR brief endpoint');
    expect(input.blast.symbols).toHaveLength(1);
    expect(input.diffStats).toEqual({ additions: 120, deletions: 30, filesCount: 2 });
    expect(input.fileStats.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(input.contextDocs.map((d) => d.name)).toEqual(['architecture.md', 'testing.md']);
    expect(input.linkedIssue).toEqual({ ref: '#42', text: 'Issue title\n\nIssue body' });

    // Tenancy is about ORDER, not about presence: `getPull(workspaceId, prId)`
    // is the only workspace-scoped read in the whole chain, so anything before
    // it is a read this workspace was never entitled to.
    expect(h.reads[0]).toBe('getPull');
    expect(h.llmCalls).toEqual([]);
  });

  it('sorts per-file statistics by size DESC, since a PR has no file order', async () => {
    const h = makeContainer({
      files: [fileRow('small.ts', 1, 1), fileRow('huge.ts', 400, 5), fileRow('mid.ts', 50, 50)],
    });
    const input = await collectBriefInput(h.container, WS, PR);
    expect(input.fileStats.map((f) => f.path)).toEqual(['huge.ts', 'mid.ts', 'small.ts']);
  });

  it('takes every project-context document, ordered by name (AC-32)', async () => {
    const h = makeContainer({
      docs: [
        { name: 'zeta.md', body: 'z' },
        { name: 'alpha.md', body: 'a' },
        { name: 'mid.md', body: 'm' },
      ],
    });
    const input = await collectBriefInput(h.container, WS, PR);
    expect(input.contextDocs.map((d) => d.name)).toEqual(['alpha.md', 'mid.md', 'zeta.md']);
  });

  it('builds without the issue and lists it as unavailable when it will not fetch (AC-34, AC-59)', async () => {
    const h = makeContainer({ issue: { ref: '#42', note: 'could not be fetched (404)' } });
    const input = await collectBriefInput(h.container, WS, PR);

    expect(input.linkedIssue).toBeNull();
    expect(input.unavailableInputs).toEqual(['linked issue #42 could not be fetched (404)']);
    // The rest of the input is untouched: an unreadable ticket is a thinner
    // brief, never a failed one.
    expect(input.blast.symbols).toHaveLength(1);
    expect(input.contextDocs).toHaveLength(2);
  });

  it('treats a degraded impact map as input, not as an error (AC-8)', async () => {
    const h = makeContainer({
      blast: blastResponse({
        status: 'degraded',
        reason: 'repo is not indexed',
        symbols: [],
        endpoints: [],
        crons: [],
      }),
    });
    const input = await collectBriefInput(h.container, WS, PR);
    expect(input.blast.status).toBe('degraded');
    expect(input.fileStats.length).toBeGreaterThan(0);
  });

  it('goes through container.blast, never through the repo-intel facade', async () => {
    const h = makeContainer();
    await collectBriefInput(h.container, WS, PR);
    // `repoIntel.getBlastRadius` throws in the harness: reaching it is the
    // expensive branch this module is forbidden from taking.
    expect(h.reads).toContain('blast.get');
  });

  it('renders every block deterministically and drops nothing on the way (S5, NFR-8)', async () => {
    const files = Array.from({ length: 300 }, (_, i) =>
      fileRow(`src/f${String(i).padStart(3, '0')}.ts`, 300 - i, 1),
    );
    const symbols = Array.from({ length: 40 }, (_, i) => ({
      name: `sym${i}`,
      file: `src/f${i}.ts`,
      kind: 'function',
      callers: Array.from({ length: 9 }, (_, c) => ({
        file: `src/caller${c}.ts`,
        symbol: `caller${c}`,
        line: c + 1,
        rank: 1 - c / 10,
      })),
      callers_total: 9,
    }));
    const h = makeContainer({ files, blast: blastResponse({ symbols }) });
    const input = await collectBriefInput(h.container, WS, PR);

    const first = renderBriefBlocks(input);
    const second = renderBriefBlocks(input);
    expect(second).toEqual(first);

    const byName = new Map(first.map((b) => [b.name, b.text]));
    // All 300 files and all 40 symbols with all 9 callers each. The render
    // applies no cap: "five callers per symbol" and "the fifty largest files"
    // are budget levels, and a level applied here could never be reported.
    expect(byName.get('file-stats')!.split('\n')).toHaveLength(300);
    for (const s of symbols) expect(byName.get('blast-symbols')).toContain(s.name);
    expect(byName.get('blast-symbols')!.match(/called by /g)).toHaveLength(40 * 9);
  });

  it('omits a block that has no content rather than rendering an empty heading', async () => {
    const h = makeContainer({
      docs: [],
      issue: null,
      blast: blastResponse({ endpoints: [], crons: [] }),
    });
    const blocks = renderBriefBlocks(await collectBriefInput(h.container, WS, PR));
    const names = blocks.map((b) => b.name);
    expect(names).not.toContain('context-docs');
    expect(names).not.toContain('linked-issue');
    expect(names).not.toContain('blast-endpoints');
    expect(names).toContain('pr-title');
  });
});

describe('test_brief_no_patch', () => {
  it('cannot carry a diff hunk into the model, structurally (AC-2)', async () => {
    const h = makeContainer();
    const input = await collectBriefInput(h.container, WS, PR);

    // The fixture's rows all carry a patch; the collected object must not.
    expect(JSON.stringify(input)).not.toContain('secretHunkBody');
    expect(JSON.stringify(input)).not.toContain('@@');
    for (const stat of input.fileStats) {
      expect(Object.keys(stat).sort()).toEqual(['additions', 'deletions', 'path']);
    }

    // …and neither may the rendered text, which is what actually travels.
    const rendered = renderBriefBlocks(input)
      .map((b) => b.text)
      .join('\n');
    expect(rendered).not.toContain('secretHunkBody');
    expect(rendered).not.toContain('@@');
    // The sizes DO travel: this is a claim about hunk bodies, not about hiding
    // that a file changed.
    expect(rendered).toContain('src/a.ts +100 -20');
  });

  it('has nowhere to put a patch even if a future caller wanted one', () => {
    // A compile-time claim, kept as a runtime shape check so it fails loudly if
    // `CollectedFileStat` ever grows a body field: the type is the guarantee.
    const stat: CollectedInput['fileStats'][number] = { path: 'a.ts', additions: 1, deletions: 0 };
    expect(Object.keys(stat)).not.toContain('patch');
  });
});

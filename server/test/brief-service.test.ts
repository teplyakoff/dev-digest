import { describe, it, expect } from 'vitest';
import type { BlastResponse, PrIntentRecord, StructuredRequest } from '@devdigest/shared';
import { BriefService } from '../src/modules/brief/service.js';
import { BriefInputTooLargeError } from '../src/modules/brief/pipeline/budget.js';
import { BRIEF_EXTRACTION_SCHEMA_NAME } from '../src/modules/brief/pipeline/schema.js';
import type { PrBriefRow, UpsertBrief } from '../src/modules/brief/repository.js';
import type { Container } from '../src/platform/container.js';
import type { PullRow, ReviewRepository } from '../src/modules/reviews/repository.js';
import { approxTokens } from '../src/adapters/tokenizer/index.js';

/**
 * `BriefService` — the one model call, its cost, its repair budget, and the
 * budget gate in front of it.
 *
 * NO DOCKER: ring-2 use case with override doubles (onion §12). The repository
 * is a double that RECORDS what it was asked to write, so the assertions are
 * about the persisted output rather than about which methods were called —
 * asserting a call count tests the wiring, asserting the row tests the
 * behaviour.
 *
 * The claim this file exists for is a NEGATIVE one and it is the expensive kind:
 * an over-budget input must not reach the provider. The `llm()` double therefore
 * THROWS on use, so the test passes only if no call was made — a double that
 * merely counted would prove the call was cheap, not that it was absent.
 */

type PrFileRow = Awaited<ReturnType<ReviewRepository['getPrFiles']>>[number];

const WS = 'ws-1';
const PR = 'pr-1';
const SHA = 'deadbee';

const INTENT: PrIntentRecord = {
  summary: 'Adds a brief',
  in_scope: ['server'],
  out_of_scope: [],
  pr_id: PR,
  confidence: 'high',
  sources: [],
  missing_context: [],
  head_sha: SHA,
  provider: 'openrouter',
  model: 'm',
  derived_at: '2026-08-25T00:00:00.000Z',
  tokens_in: 1,
  tokens_out: 1,
  cost_usd: null,
};

const BLAST: BlastResponse = {
  status: 'full',
  reason: null,
  changed_files: ['src/a.ts'],
  symbols: [
    {
      name: 'buildBrief',
      file: 'src/a.ts',
      kind: 'function',
      callers: [{ file: 'src/b.ts', symbol: 'caller', line: 4, rank: 1 }],
      callers_total: 1,
    },
  ],
  endpoints: [{ route: 'GET /pulls/:id/brief', file: 'src/r.ts', depth: 0, via: 'src/a.ts' }],
  crons: [],
  indexed_sha: SHA,
  counts: { symbols: 1, callers: 1, endpoints: 1 },
};

const EXTRACTION = {
  what: 'Adds a brief endpoint',
  why: 'So reviewers can see the risk up front',
  risk_level: 'medium' as const,
  risks: [
    {
      kind: 'regression',
      title: 'The route may 500 on a PR with no index',
      explanation: 'degraded blast is not handled',
      severity: 'medium' as const,
      file_refs: ['src/a.ts'],
    },
  ],
  review_focus: [{ path: 'src/a.ts', reason: 'the new handler' }],
};

interface Harness {
  service: BriefService;
  /** Rows the service asked to persist, in order. */
  written: UpsertBrief[];
  /** Structured requests that reached a provider. Empty means none did. */
  requests: StructuredRequest<unknown>[];
  /** One entry per intent resolution: "derived" cost a call, "reused" did not. */
  intentDerivations: string[];
  logs: { obj: Record<string, unknown>; msg?: string }[];
}

function makeService(
  opts: {
    files?: PrFileRow[];
    extraction?: Record<string, unknown>;
    costUsd?: number | null;
    attempts?: number;
    llmThrows?: boolean;
    docs?: { name: string; body: string }[];
    blast?: BlastResponse;
    intentReused?: boolean;
  } = {},
): Harness {
  const written: UpsertBrief[] = [];
  const requests: StructuredRequest<unknown>[] = [];
  const intentDerivations: string[] = [];
  const logs: { obj: Record<string, unknown>; msg?: string }[] = [];

  const container = {
    db: {},
    config: {},
    tokenizer: { count: (t: string) => approxTokens(t) },
    reviewRepo: {
      getPull: async (): Promise<PullRow | undefined> =>
        ({
          id: PR,
          workspaceId: WS,
          repoId: 'repo-1',
          title: 'feat: a brief',
          headSha: SHA,
          additions: 10,
          deletions: 1,
          filesCount: 1,
        }) as PullRow,
      getRepo: async () => ({ id: 'repo-1', owner: 'o', name: 'n' }),
      getPrFiles: async () =>
        opts.files ?? [
          { id: 'f1', prId: PR, path: 'src/a.ts', additions: 10, deletions: 1, patch: '@@ x' },
        ],
    },
    loadPrDiff: async () => ({ files: [] }),
    intent: {
      view: async () => ({ intent: INTENT }),
      // The classifier's own reuse decision, faked in one flag: `reused: true`
      // is a warm PR (one call in total), `false` is a cold one (two).
      deriveIfStale: async () => {
        intentDerivations.push(opts.intentReused === false ? 'derived' : 'reused');
        return { record: INTENT, reused: opts.intentReused ?? true };
      },
      renderIntentBlock: () => 'Intent: Adds a brief',
      linkedIssueText: async () => null,
    },
    blast: { get: async () => opts.blast ?? BLAST },
    contextRepo: { listDocs: async () => opts.docs ?? [] },
    featureModel: async () => null,
    llm: async () => {
      if (opts.llmThrows) {
        throw new Error('the provider was reached — an over-budget input must never get here');
      }
      return {
        id: 'openai' as const,
        completeStructured: async (req: StructuredRequest<unknown>) => {
          requests.push(req);
          const parsed = (req.schema as { parse: (v: unknown) => unknown }).parse(
            opts.extraction ?? EXTRACTION,
          );
          return {
            data: parsed,
            model: req.model,
            tokensIn: 1200,
            tokensOut: 300,
            costUsd: opts.costUsd === undefined ? 0.0004 : opts.costUsd,
            raw: '{}',
            attempts: opts.attempts ?? 1,
          };
        },
      };
    },
  } as unknown as Container;

  const service = new BriefService(container);
  // The repository is the write boundary; replacing it keeps this a ring-2 test.
  (service as unknown as { repo: unknown }).repo = {
    get: async (): Promise<PrBriefRow | undefined> => undefined,
    upsert: async (values: UpsertBrief): Promise<PrBriefRow> => {
      written.push(values);
      return { ...values, json: {}, derivedAt: new Date('2026-08-25T00:00:00Z') } as PrBriefRow;
    },
  };

  return {
    service,
    written,
    requests,
    intentDerivations,
    logs,
  };
}

function logger(logs: Harness['logs']) {
  return {
    info: (obj: unknown, msg?: string) => logs.push({ obj: obj as never, msg }),
    warn: () => {},
    error: () => {},
  };
}

describe('test_brief_call', () => {
  it('makes exactly one structured call for five fields (AC-6, AC-13)', async () => {
    const h = makeService();
    const view = await h.service.build(WS, PR);

    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]!.schemaName).toBe(BRIEF_EXTRACTION_SCHEMA_NAME);
    expect(view.model_calls).toBe(1);
    expect(view.brief!.what).toBe('Adds a brief endpoint');
    // No line anchors reach the client — `review_focus` is path + reason.
    expect(Object.keys(view.brief!.review_focus[0]!).sort()).toEqual(['path', 'reason']);
  });

  it('states the repair bound explicitly rather than inheriting it (AC-27, NFR-2)', async () => {
    const h = makeService();
    await h.service.build(WS, PR);
    // The provider's own default is `?? 2`, i.e. up to three requests for one
    // brief. AC-27 is met by the number being present, not by it being small.
    expect(h.requests[0]!.maxRetries).toBe(1);
  });

  it('persists the attempt count, so a repaired build is distinguishable (AC-28)', async () => {
    const cheap = makeService();
    await cheap.service.build(WS, PR);
    expect(cheap.written[0]!.attempts).toBe(1);

    const repaired = makeService({ attempts: 2 });
    const logs: Harness['logs'] = [];
    await repaired.service.build(WS, PR, logger(logs));
    expect(repaired.written[0]!.attempts).toBe(2);
    // …and it says so in its own line: nothing else in the log tells a cheap
    // call from an expensive one.
    expect(logs.some((l) => l.msg?.includes('schema was repaired'))).toBe(true);
  });

  it('persists every grounded focus item — the ten-item cap is the CLIENT\'s (AC-40, AC-41)', async () => {
    const h = makeService({
      extraction: {
        ...EXTRACTION,
        review_focus: Array.from({ length: 17 }, () => ({
          path: 'src/a.ts',
          reason: 'in the allowlist',
        })),
      },
    });
    const view = await h.service.build(WS, PR);

    // A `slice(0, 10)` here used to truncate on the way into the row, which
    // left the card's "showing 10 of 17" (AC-41) with nothing to count: a list
    // that arrives as 10 of 10 cannot report a real total. Both AC-40 and AC-41
    // are about rendering, so both belong to the client.
    expect(view.brief!.review_focus).toHaveLength(17);
    expect(h.written[0]!.reviewFocus).toHaveLength(17);
  });

  it('sends the budgeted messages, not the raw blocks', async () => {
    const h = makeService();
    await h.service.build(WS, PR);
    const messages = h.requests[0]!.messages;
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[1]!.content).toContain('<untrusted source="pr-title">');
  });
});

describe('test_brief_cost', () => {
  it('keeps an unknown cost null instead of flattening it to zero (AC-21)', async () => {
    const h = makeService({ costUsd: null });
    const view = await h.service.build(WS, PR);
    expect(h.written[0]!.costUsd).toBeNull();
    expect(view.brief!.cost_usd).toBeNull();
  });

  it('keeps a genuine zero as zero — free is not unknown', async () => {
    const h = makeService({ costUsd: 0 });
    const view = await h.service.build(WS, PR);
    expect(view.brief!.cost_usd).toBe(0);
  });

  it('persists the token counts alongside the cost (AC-15)', async () => {
    const h = makeService();
    await h.service.build(WS, PR);
    expect(h.written[0]).toMatchObject({ tokensIn: 1200, tokensOut: 300, headSha: SHA });
  });
});

describe('test_brief_budget (service half)', () => {
  it('fails before the provider is reached when nothing fits (AC-26)', async () => {
    // The AC-24 × AC-26 interaction the spec flagged as an open question, made
    // concrete: level 5 keeps the fifty largest files and the changed-file list
    // is undroppable, so a PR whose paths are pathologically long is over budget
    // with every level already spent. 50 × ~1 200 chars ≈ 15 000 tokens.
    const deep = (n: number) =>
      `src/${'a-rather-long-directory-segment/'.repeat(37)}file-${n}.ts`;
    const files: PrFileRow[] = Array.from({ length: 200 }, (_, n) => ({
      id: `f${n}`,
      prId: PR,
      path: deep(n),
      additions: 200 - n,
      deletions: 3,
      patch: null,
    }));
    const h = makeService({ files, llmThrows: true, docs: [{ name: 'big.md', body: 'x'.repeat(60_000) }] });

    await expect(h.service.build(WS, PR)).rejects.toBeInstanceOf(BriefInputTooLargeError);
    // THE POINT: `llm()` throws a distinct error when reached, so a green test
    // proves the call was never made — not that it was cheap.
    expect(h.requests).toEqual([]);
    // Nothing was written either: a failed build leaves no half-brief behind.
    expect(h.written).toEqual([]);
  });

  it('logs the composition and the drops, and never the content', async () => {
    const logs: Harness['logs'] = [];
    const h = makeService({ docs: [{ name: 'secrets.md', body: 'THE DOCUMENT BODY' }] });
    await h.service.build(WS, PR, logger(logs));

    const line = logs.find((l) => l.msg?.startsWith('Brief input:'));
    expect(line).toBeDefined();
    expect(line!.msg).toContain('context-docs(');
    // Composition, not content: the size of the document is in the log, the
    // document is not.
    for (const l of logs) expect(JSON.stringify(l)).not.toContain('THE DOCUMENT BODY');
  });
});

describe('test_brief_grounding', () => {
  /** The extraction with a given set of risks / focus items. */
  function extraction(over: Partial<typeof EXTRACTION>) {
    return { ...EXTRACTION, ...over };
  }

  const risk = (title: string, refs: string[]) => ({
    kind: 'regression',
    title,
    explanation: 'e',
    severity: 'medium' as const,
    file_refs: refs,
  });

  it('builds the allowlist from the blast response (AC-7)', async () => {
    const h = makeService({
      extraction: extraction({
        risks: [
          risk('changed file', ['src/a.ts']),
          risk('caller file', ['src/b.ts']),
          risk('an endpoint', ['GET /pulls/:id/brief']),
        ],
      }),
    });
    const view = await h.service.build(WS, PR);
    // Changed files, symbol files, caller files AND endpoint routes all count
    // as things a risk may cite.
    expect(view.brief!.risks.map((r) => r.title)).toEqual([
      'changed file',
      'caller file',
      'an endpoint',
    ]);
  });

  it('drops a risk that cites nothing, with its own reason (AC-68)', async () => {
    const logs: Harness['logs'] = [];
    const h = makeService({
      extraction: extraction({ risks: [risk('cites nothing', []), risk('cites a file', ['src/a.ts'])] }),
    });
    const view = await h.service.build(WS, PR, logger(logs));

    expect(view.brief!.risks.map((r) => r.title)).toEqual(['cites a file']);
    expect(logs.some((l) => l.msg?.includes('cites nothing') && l.msg.includes('no refs'))).toBe(
      true,
    );
  });

  it('drops a risk citing something outside the allowlist, with a different reason (AC-9)', async () => {
    const logs: Harness['logs'] = [];
    const h = makeService({
      extraction: extraction({ risks: [risk('invented file', ['src/does-not-exist.ts'])] }),
    });
    const view = await h.service.build(WS, PR, logger(logs));

    expect(view.brief!.risks).toEqual([]);
    expect(
      logs.some((l) => l.msg?.includes('ref outside allowlist: src/does-not-exist.ts')),
    ).toBe(true);
  });

  it('counts both drop reasons in the SAME M, with one counter (AC-11, AC-68)', async () => {
    const logs: Harness['logs'] = [];
    const h = makeService({
      extraction: extraction({
        risks: [risk('no refs', []), risk('stray', ['nope.ts']), risk('good', ['src/a.ts'])],
      }),
    });
    await h.service.build(WS, PR, logger(logs));

    const line = logs.find((l) => l.msg?.startsWith('Risk grounding:'));
    // One ratio over both reasons: `N/M` exists to tell "the model found
    // nothing" from "we dropped everything it found", and a second counter
    // would make that headline ambiguous.
    expect(line!.msg).toContain('1/3 passed');
    expect(line!.obj).toMatchObject({ kept: 1, total: 3 });
  });

  it('writes the N/M line even when nothing was dropped (AC-11, NFR-5)', async () => {
    const logs: Harness['logs'] = [];
    const h = makeService();
    await h.service.build(WS, PR, logger(logs));

    const line = logs.find((l) => l.msg?.startsWith('Risk grounding:'));
    // UNCONDITIONAL. A gate that reports only when it acts is indistinguishable
    // from a gate that never ran.
    expect(line).toBeDefined();
    expect(line!.msg).toContain('1/1 passed');
    expect(line!.msg).toContain('every risk cited the input');
  });

  it('keeps the model risk_level and flags the brief when every risk is dropped (AC-12, AC-58)', async () => {
    const h = makeService({
      extraction: extraction({
        risk_level: 'high',
        risks: [risk('a', []), risk('b', ['invented.ts'])],
      }),
    });
    const view = await h.service.build(WS, PR);

    expect(view.brief!.risks).toEqual([]);
    // The headline is the model's and survives — dropping our evidence for it
    // does not make the PR safe.
    expect(view.brief!.risk_level).toBe('high');
    expect(view.brief!.risks_grounded).toBe(false);
    expect(h.written[0]!.risksGrounded).toBe(false);
  });

  it('stays grounded when the model simply found no risks', async () => {
    const h = makeService({ extraction: extraction({ risks: [] }) });
    const view = await h.service.build(WS, PR);
    // M = 0 is "nothing found", not "everything dropped".
    expect(view.brief!.risks_grounded).toBe(true);
  });

  it('drops a focus item whose path is really an endpoint route (AC-10)', async () => {
    const h = makeService({
      extraction: extraction({
        review_focus: [
          { path: 'GET /pulls/:id/brief', reason: 'the route' },
          { path: 'src/a.ts', reason: 'the handler' },
        ],
      }),
    });
    const view = await h.service.build(WS, PR);

    // The route IS in the risk allowlist and is deliberately NOT in the focus
    // one: the client turns each focus item into a link into the diff, and a
    // route has no file to open.
    expect(view.brief!.review_focus.map((f) => f.path)).toEqual(['src/a.ts']);
  });

  it('falls back to the PR files when the impact map is degraded (AC-8)', async () => {
    const h = makeService({
      blast: {
        status: 'degraded',
        reason: 'repo is not indexed',
        changed_files: ['src/a.ts'],
        symbols: [],
        endpoints: [],
        crons: [],
        indexed_sha: null,
        counts: { symbols: 0, callers: 0, endpoints: 0 },
      },
      extraction: extraction({
        risks: [risk('about a changed file', ['src/a.ts']), risk('about a caller', ['src/b.ts'])],
        review_focus: [
          { path: 'src/a.ts', reason: 'changed' },
          { path: 'src/b.ts', reason: 'a caller the index never reported' },
        ],
      }),
    });
    const view = await h.service.build(WS, PR);

    // With no index there is no caller list, so `src/b.ts` is not ground: the
    // allowlist is the diff and nothing else. Degrading to "everything passes"
    // would be the failure this feature exists to avoid.
    expect(view.brief!.risks.map((r) => r.title)).toEqual(['about a changed file']);
    expect(view.brief!.review_focus.map((f) => f.path)).toEqual(['src/a.ts']);
  });
});

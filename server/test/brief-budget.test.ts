import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '@devdigest/shared';
import {
  fitToBudget,
  assertUndroppableIntact,
  BriefInputTooLargeError,
} from '../src/modules/brief/pipeline/budget.js';
import { assembleBriefMessages } from '../src/modules/brief/pipeline/prompt.js';
import { renderBriefBlocks, type CollectedInput } from '../src/modules/brief/pipeline/sources.js';
import { MAX_CALLERS_IN_BRIEF, MAX_FILE_STATS_IN_BRIEF } from '../src/modules/brief/constants.js';
import { approxTokens, type Tokenizer } from '../src/adapters/tokenizer/index.js';

/**
 * `fitToBudget` — the token budget, its six levels and their order.
 *
 * NO CONTAINER AND NO DATABASE: the rule is a pure computation over an input, an
 * assembler and a counter, which is the whole reason it lives one ring in from
 * the service (onion §7).
 *
 * The counter here is the heuristic one on purpose. What these tests pin is the
 * ORDER and the REPORTING of the levels, and both are properties of the loop
 * rather than of `cl100k_base`; a deterministic counter also makes the budgets
 * below readable numbers instead of encoder trivia. The claim that the real
 * counter is used in production is pinned at the call site, in `service.ts`.
 */

const counter: Tokenizer = { count: (t) => approxTokens(t) };

function doc(name: string, size: number) {
  return { name, body: 'd'.repeat(size) };
}

function input(over: Partial<CollectedInput> = {}): CollectedInput {
  return {
    prId: 'pr-1',
    headSha: 'deadbee',
    prTitle: 'feat: a change',
    intentBlock: 'Intent: ships a thing\nIn scope: server',
    blast: {
      status: 'full',
      reason: null,
      changed_files: ['src/a.ts'],
      symbols: [
        {
          name: 'sym',
          file: 'src/a.ts',
          kind: 'function',
          callers: [{ file: 'src/b.ts', symbol: 'caller', line: 1, rank: 1 }],
          callers_total: 1,
        },
      ],
      endpoints: [{ route: 'GET /x', file: 'src/r.ts', depth: 0, via: 'src/a.ts' }],
      crons: [{ name: 'nightly', file: 'src/j.ts', depth: 0, via: 'src/a.ts' }],
      indexed_sha: 'deadbee',
      counts: { symbols: 1, callers: 1, endpoints: 1 },
    },
    diffStats: { additions: 10, deletions: 2, filesCount: 1 },
    fileStats: [{ path: 'src/a.ts', additions: 10, deletions: 2 }],
    fileStatSizesFor: null,
    contextDocs: [],
    linkedIssue: null,
    unavailableInputs: [],
    ...over,
  };
}

/** The assembled size of an input, in the same unit `fitToBudget` measures. */
function sizeOf(i: CollectedInput): number {
  return assembleBriefMessages(i).reduce((n, m) => n + counter.count(m.content), 0);
}

/**
 * The input with every level applied — the floor a budget cannot go under.
 *
 * Computed rather than written as a literal because the floor includes the
 * system prompt, the guard and the wrappers: a hand-picked number here would
 * be under the floor and every test in this block would fail as AC-26 rather
 * than testing the levels at all.
 */
function floorOf(i: CollectedInput): number {
  return sizeOf({
    ...i,
    contextDocs: [],
    linkedIssue: null,
    // Level 5 keeps every file and drops the numbers past the 50th, so the
    // floor keeps every file too.
    fileStatSizesFor: MAX_FILE_STATS_IN_BRIEF,
    blast: {
      ...i.blast,
      crons: [],
      endpoints: [],
      symbols: i.blast.symbols.map((s) => ({
        ...s,
        callers: s.callers.slice(0, MAX_CALLERS_IN_BRIEF),
      })),
    },
  });
}

function blockNames(messages: ChatMessage[]): string[] {
  return [...messages[1]!.content.matchAll(/<untrusted source="([^"]+)">/g)].map((m) => m[1]!);
}

describe('test_brief_budget', () => {
  it('measures the ASSEMBLED messages with a counter, before anything is sent (AC-22, NFR-1)', () => {
    const i = input();
    const counted: string[] = [];
    const spy: Tokenizer = {
      count: (t) => {
        counted.push(t);
        return approxTokens(t);
      },
    };
    const fit = fitToBudget(i, assembleBriefMessages, spy, 100_000);

    // Both messages were counted, and what was counted IS what is returned —
    // not the blocks that feed them. The system prompt and the guard weigh as
    // much as the content on a PR this size, which is the entire reason the
    // unit is the assembled message.
    expect(counted).toEqual(fit.messages.map((m) => m.content));
    const blockOnly = renderBriefBlocks(i).reduce((n, b) => n + counter.count(b.text), 0);
    expect(fit.tokens).toBeGreaterThan(blockOnly);
  });

  it('never drops the title, the intent summary or ANY changed-file path (AC-24)', () => {
    const paths = Array.from({ length: 200 }, (_, n) => `src/f${String(n).padStart(3, '0')}.ts`);
    const i = input({
      contextDocs: [doc('a.md', 4_000), doc('b.md', 4_000)],
      fileStats: paths.map((path, n) => ({ path, additions: 200 - n, deletions: 1 })),
      linkedIssue: { ref: '#1', text: 'x'.repeat(4_000) },
    });
    // A budget tight enough to force every level to fire.
    const fit = fitToBudget(i, assembleBriefMessages, counter, floorOf(i) + 5);
    // Every level really did fire — otherwise this proves nothing about AC-24.
    expect(fit.dropped).toContain('file-stats:numbers');
    expect(fit.dropped).toContain('linked-issue');

    // ENUMERATED, ONE PATH AT A TIME. `blockNames(...).toContain('file-stats')`
    // is what this assertion used to be, and it stayed green whether the block
    // held 200 paths or 50 — which is the reading AC-24 was rewritten to
    // remove. The allowlist is built from these paths, so a missing one is not
    // a display loss: it turns a correct citation into a dropped risk.
    const prompt = fit.messages[1]!.content;
    for (const path of paths) expect(prompt).toContain(path);
    expect(fit.input.fileStats.map((f) => f.path)).toEqual(paths);

    expect(blockNames(fit.messages)).toContain('pr-title');
    expect(blockNames(fit.messages)).toContain('intent');
    expect(fit.input.prTitle).toBe('feat: a change');
    expect(fit.input.intentBlock).toContain('In scope');
  });

  it('lists every applied drop and nothing else (AC-25, NFR-8)', () => {
    const i = input({ contextDocs: [doc('a.md', 200), doc('b.md', 8_000)] });
    const fit = fitToBudget(i, assembleBriefMessages, counter, sizeOf(input()) + 100);

    // `b.md` goes first (last by name), and it alone was enough — so `a.md` is
    // NOT in the list, because it was not dropped.
    expect(fit.dropped).toEqual(['context-docs:b.md']);
    expect(fit.input.contextDocs.map((d) => d.name)).toEqual(['a.md']);
    // Nothing else moved: a report that over-claims is as bad as one that hides.
    expect(fit.input.blast.crons).toHaveLength(1);
    expect(fit.input.blast.endpoints).toHaveLength(1);
  });

  it('reports no drops at all when everything fits', () => {
    const fit = fitToBudget(input(), assembleBriefMessages, counter, 100_000);
    expect(fit.dropped).toEqual([]);
  });

  it('fails loudly when it still does not fit after every level (AC-26)', () => {
    // The undroppable half alone is over budget — exactly the AC-24 × AC-26
    // interaction the spec left open, and it must be an error, not a silent cut.
    const i = input({
      fileStats: Array.from({ length: 40 }, (_, n) => ({
        path: `src/very/long/path/number/${n}/file.ts`,
        additions: 40 - n,
        deletions: 1,
      })),
    });
    expect(() => fitToBudget(i, assembleBriefMessages, counter, 50)).toThrow(
      BriefInputTooLargeError,
    );
    try {
      fitToBudget(i, assembleBriefMessages, counter, 50);
    } catch (err) {
      const e = err as BriefInputTooLargeError;
      expect(e.statusCode).toBe(409);
      expect(e.code).toBe('brief_input_too_large');
      // The failure still names what it tried — a refusal with no account of
      // the reductions is unactionable.
      expect(e.details).toMatchObject({ budget: 50 });
    }
  });
});

describe('test_brief_budget_order', () => {
  it('exhausts a level before starting the next one (AC-23)', () => {
    // Three documents and one cron. If level 1 is exhausted properly, all three
    // documents go before the cron is even considered.
    const i = input({
      contextDocs: [doc('a.md', 3_000), doc('b.md', 3_000), doc('c.md', 3_000)],
    });
    const noDocs = sizeOf(input());
    const fit = fitToBudget(i, assembleBriefMessages, counter, noDocs + 10);

    expect(fit.dropped).toEqual([
      'context-docs:c.md',
      'context-docs:b.md',
      'context-docs:a.md',
    ]);
    expect(fit.input.blast.crons).toHaveLength(1);
  });

  it('does not reach level 3 while level 2 still has material', () => {
    // THE CASE THIS FILE EXISTS FOR. An implementation that walks the levels
    // once, applying each while over budget, drops endpoints here even though
    // documents and crons had more to give — and the prompt loses the endpoint
    // list for nothing.
    const i = input({
      contextDocs: [doc('a.md', 400), doc('b.md', 12_000)],
    });
    const target = sizeOf(input({ contextDocs: [doc('a.md', 400)] })) + 10;
    const fit = fitToBudget(i, assembleBriefMessages, counter, target);

    expect(fit.dropped).toEqual(['context-docs:b.md']);
    expect(fit.dropped).not.toContain('blast-crons');
    expect(fit.dropped).not.toContain('blast-endpoints');
    expect(fit.input.blast.endpoints).toHaveLength(1);
  });

  it('stops the moment it fits, leaving later levels untouched', () => {
    const i = input({
      contextDocs: [doc('a.md', 8_000)],
      linkedIssue: { ref: '#7', text: 'issue text' },
    });
    const fit = fitToBudget(i, assembleBriefMessages, counter, sizeOf(input()) + 200);
    expect(fit.dropped).toEqual(['context-docs:a.md']);
    expect(fit.input.linkedIssue).not.toBeNull();
  });
});

describe('test_brief_budget_levels', () => {
  /** Force exactly the levels up to and including `through`, then measure. */
  function bigInput(): CollectedInput {
    return input({
      contextDocs: [doc('a.md', 2_000)],
      fileStats: Array.from({ length: 120 }, (_, n) => ({
        path: `src/f${String(n).padStart(3, '0')}.ts`,
        additions: 120 - n,
        deletions: 1,
      })),
      blast: {
        ...input().blast,
        crons: Array.from({ length: 30 }, (_, n) => ({
          name: `cron-${n}`,
          file: 'src/j.ts',
          depth: 0,
          via: 'src/a.ts',
        })),
        endpoints: Array.from({ length: 30 }, (_, n) => ({
          route: `GET /route/${n}`,
          file: 'src/r.ts',
          depth: 0,
          via: 'src/a.ts',
        })),
        symbols: [
          {
            name: 'sym',
            file: 'src/a.ts',
            kind: 'function',
            callers: Array.from({ length: 30 }, (_, n) => ({
              file: `src/caller${String(n).padStart(2, '0')}.ts`,
              symbol: `caller${n}`,
              line: n + 1,
              rank: 1 - n / 100,
            })),
            callers_total: 30,
          },
        ],
      },
      linkedIssue: { ref: '#7', text: 'i'.repeat(2_000) },
    });
  }

  it('applies the six levels in the order the spec fixes (AC-61…AC-66)', () => {
    const i = bigInput();
    // A budget only the fully-reduced input can meet.
    const fit = fitToBudget(i, assembleBriefMessages, counter, floorOf(i) + 5);

    expect(fit.dropped).toEqual([
      'context-docs:a.md', // 1
      'blast-crons', // 2
      'blast-endpoints', // 3
      'blast-symbols', // 4
      'file-stats:numbers', // 5
      'linked-issue', // 6
    ]);
  });

  it('caps callers PER SYMBOL, not across the flat list (AC-64)', () => {
    const base = bigInput();
    const i = input({
      ...base,
      blast: {
        ...base.blast,
        symbols: [0, 1, 2].map((s) => ({
          name: `sym${s}`,
          file: `src/f${s}.ts`,
          kind: 'function',
          callers: Array.from({ length: 12 }, (_, n) => ({
            file: `src/c${s}-${String(n).padStart(2, '0')}.ts`,
            symbol: `c${s}_${n}`,
            line: n + 1,
            rank: 1 - n / 100,
          })),
          callers_total: 12,
        })),
      },
    });
    const fit = fitToBudget(i, assembleBriefMessages, counter, floorOf(i) + 5);

    expect(fit.dropped).toContain('blast-symbols');
    for (const s of fit.input.blast.symbols) {
      // Every symbol keeps five. A flat `slice(0, 5)` would leave two symbols
      // with none, and "nothing calls this" is a claim a reviewer acts on.
      expect(s.callers).toHaveLength(MAX_CALLERS_IN_BRIEF);
      // The TOTAL is not rewritten to match the cut list.
      expect(s.callers_total).toBe(12);
    }
  });

  it('drops the NUMBERS past the 50 largest and keeps every path (AC-65, AC-24)', () => {
    // 200 files, so the level has 150 files' worth of numbers to give up.
    const paths = Array.from({ length: 200 }, (_, n) => `src/f${String(n).padStart(3, '0')}.ts`);
    const base = bigInput();
    const i = input({
      ...base,
      fileStats: paths.map((path, n) => ({ path, additions: 200 - n, deletions: 1 })),
    });
    const fit = fitToBudget(i, assembleBriefMessages, counter, floorOf(i) + 5);

    expect(fit.dropped).toContain('file-stats:numbers');
    expect(fit.input.fileStatSizesFor).toBe(MAX_FILE_STATS_IN_BRIEF);
    // Not one file was removed from the input…
    expect(fit.input.fileStats).toHaveLength(200);

    const block = renderBriefBlocks(fit.input).find((b) => b.name === 'file-stats')!;
    const lines = block.text.split('\n');
    expect(lines).toHaveLength(200);
    // …the 50 largest still carry their counts…
    expect(lines[0]).toBe('src/f000.ts +200 -1');
    expect(lines[49]).toBe('src/f049.ts +151 -1');
    // …and the rest are a bare path: still in front of the model, still in the
    // grounding allowlist, no longer saying how much of them changed.
    expect(lines[50]).toBe('src/f050.ts');
    expect(lines[199]).toBe('src/f199.ts');
    for (const path of paths) expect(block.text).toContain(path);
    // "Largest" is by size, not by position in the array the DB happened to
    // return: `f000` is the biggest, and it keeps its numbers.
    expect(lines.slice(50).some((l) => l.includes('+'))).toBe(false);
  });

  it('refuses to let a level touch an undroppable block (AC-24, enforced)', () => {
    // THE GUARD ITSELF, called the way `fitToBudget` calls it. This is why
    // `UNDROPPABLE_BLOCKS` is imported by code instead of only described in a
    // comment: the list used to sit in `constants.ts` claiming it stopped a
    // future level being added over one of these blocks, was imported by
    // nothing, and level 5 violated it for a whole implementation round.
    const original = input({
      fileStats: Array.from({ length: 60 }, (_, n) => ({
        path: `src/f${n}.ts`,
        additions: 60 - n,
        deletions: 1,
      })),
    });

    // Level 5 as it now behaves — numbers gone, every path kept — is legal.
    expect(() =>
      assertUndroppableIntact(
        original,
        { ...original, fileStatSizesFor: MAX_FILE_STATS_IN_BRIEF },
        5,
      ),
    ).not.toThrow();

    // Level 5 as it used to behave — 50 of 60 paths — is not, and the message
    // names the block rather than leaving the next reader to find it.
    expect(() =>
      assertUndroppableIntact(
        original,
        { ...original, fileStats: original.fileStats.slice(0, MAX_FILE_STATS_IN_BRIEF) },
        5,
      ),
    ).toThrow(/file-stats/);

    // The other two are guarded on the same terms.
    expect(() =>
      assertUndroppableIntact(original, { ...original, prTitle: 'shorter' }, 1),
    ).toThrow(/pr-title/);
    expect(() =>
      assertUndroppableIntact(original, { ...original, intentBlock: null }, 1),
    ).toThrow(/intent/);
  });

  it('drops documents whole, never in part, from the end of the name order (AC-61)', () => {
    const i = input({
      contextDocs: [doc('a.md', 3_000), doc('b.md', 3_000), doc('c.md', 3_000)],
    });
    const fit = fitToBudget(i, assembleBriefMessages, counter, sizeOf(input()) + 800);

    // c.md went first; the ones that stayed are byte-identical to what was
    // collected — no document is ever half-sent.
    expect(fit.dropped[0]).toBe('context-docs:c.md');
    for (const kept of fit.input.contextDocs) {
      expect(kept.body).toBe(i.contextDocs.find((d) => d.name === kept.name)!.body);
    }
  });
});

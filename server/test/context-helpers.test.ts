import { describe, it, expect } from 'vitest';
import {
  candidatesFrom,
  isImportablePath,
  looksBinary,
  orderedSpecs,
  skipReasonFor,
  tokenCountsFor,
  type ScannedFile,
} from '../src/modules/context/helpers.js';
import { MAX_DOC_BYTES } from '../src/modules/context/constants.js';

/**
 * The pure rules of the project-context store, with no database and no clone.
 *
 * These four functions decide what a person is offered, why a file is refused,
 * what a document appears to cost, and — the one that reaches the model — in
 * what order and with what identity bodies enter the prompt. Everything around
 * them is orchestration, and is covered by the integration tests.
 */

const file = (bytes: number, unreadable = false): ScannedFile => ({ bytes, unreadable });

/** A tokenizer that is trivially predictable, so the assertions are about the
 *  wiring rather than about tiktoken's answer for a given string. */
const wordCounter = { count: (text: string) => text.split(/\s+/).filter(Boolean).length };

describe('test_context_candidates', () => {
  it('sorts alphabetically, then caps, and says when the cap bit', () => {
    const paths = ['docs/z.md', 'README.md', 'docs/a.md'];
    const scanned = new Map(paths.map((p) => [p, file(10)]));

    const all = candidatesFrom(paths, scanned, { maxEntries: 10, truncated: false });
    expect(all.candidates.map((c) => c.path)).toEqual(['README.md', 'docs/a.md', 'docs/z.md']);
    expect(all.truncated).toBe(false);

    // Sorted BEFORE the cap, so the same first N survive every rescan. A cap
    // applied to filesystem order would return a different two each time.
    const capped = candidatesFrom(paths, scanned, { maxEntries: 2, truncated: false });
    expect(capped.candidates.map((c) => c.path)).toEqual(['README.md', 'docs/a.md']);
    expect(capped.truncated).toBe(true);
  });

  it('carries the walk’s own truncation through, even when this cap did not bite', () => {
    // The walk hit `maxEntries` first and said so. Re-deriving the flag from
    // `candidates.length` here would silently claim the list is complete.
    const listed = candidatesFrom(['a.md'], new Map([['a.md', file(3)]]), {
      maxEntries: 500,
      truncated: true,
    });
    expect(listed.candidates).toHaveLength(1);
    expect(listed.truncated).toBe(true);
  });

  it('keeps a skipped file in the list, with its reason', () => {
    const paths = ['ok.md', 'big.md'];
    const scanned = new Map([
      ['ok.md', file(4)],
      ['big.md', file(MAX_DOC_BYTES + 1)],
    ]);
    const { candidates } = candidatesFrom(paths, scanned, { maxEntries: 10, truncated: false });

    // Hiding it would turn "why is my file not offered?" into a question the
    // picker raises instead of answers.
    expect(candidates.map((c) => [c.path, c.status, c.reason])).toEqual([
      ['big.md', 'skipped', 'too_large'],
      ['ok.md', 'ok', undefined],
    ]);
  });
});

describe('test_context_skip_reasons', () => {
  // One case per reason, because AC-4 puts three distinct triggers under one id
  // and a single assertion could not tell which of them still works.
  it('too_large — one byte over the per-document bound', () => {
    expect(skipReasonFor('big.md', MAX_DOC_BYTES + 1, file(0))).toBe('too_large');
    expect(skipReasonFor('edge.md', MAX_DOC_BYTES, file(0))).toBeUndefined();
  });

  it('not_utf8 — the replacement character, which is the only signal there is', () => {
    // `readFile(…, "utf8")` does not throw on invalid bytes, it substitutes
    // U+FFFD. A check for a thrown error would never fire.
    expect(looksBinary('PK\uFFFD\uFFFD')).toBe(true);
    expect(looksBinary('# plain markdown')).toBe(false);
    expect(skipReasonFor('binary.md', 12, file(0, true))).toBe('not_utf8');
  });

  it('outside_clone — the path never named a file this repo offers', () => {
    expect(skipReasonFor('/etc/passwd', 10, file(0))).toBe('outside_clone');
    expect(skipReasonFor('../secrets.md', 10, file(0))).toBe('outside_clone');
  });

  it('refuses a path before its size, so an unofferable path is never read', () => {
    expect(skipReasonFor('../secrets.md', MAX_DOC_BYTES + 1, file(0, true))).toBe('outside_clone');
  });
});

/**
 * The one rule the picker and the create endpoint share.
 *
 * It exists because they did NOT share one: `list()` filtered by extension and
 * skipped `EXCLUDED_DIRS`, and the create endpoint — which takes its path from
 * the request body — applied neither. `{"kind":"import","path":".git/config"}`
 * therefore read a file the picker would never offer, and that file carries the
 * GitHub token as a URL password, so the secret came back in the response and
 * into the database.
 */
describe('isImportablePath', () => {
  it('offers a plain .md inside the clone', () => {
    expect(isImportablePath('README.md')).toBe(true);
    expect(isImportablePath('docs/PRD.md')).toBe(true);
    expect(isImportablePath('docs/PRD.MD')).toBe(true);
  });

  it('REFUSES anything under an excluded directory — .git above all', () => {
    // The exact request that leaked the token.
    expect(isImportablePath('.git/config')).toBe(false);
    expect(isImportablePath('a/.git/config')).toBe(false);
    expect(isImportablePath('node_modules/pkg/README.md')).toBe(false);
    expect(isImportablePath('vendor/thing/NOTES.md')).toBe(false);
  });

  it('matches an excluded directory case-INSENSITIVELY', () => {
    // Not pedantry: macOS filesystems are case-insensitive by default, so on the
    // platform most of this is written on, `Vendor/x.md` opens `vendor/x.md`.
    // A case-sensitive comparison against a lowercase list is an exclusion that
    // silently does not hold where it matters most.
    expect(isImportablePath('Vendor/x.md')).toBe(false);
    expect(isImportablePath('NODE_MODULES/pkg/README.md')).toBe(false);
    expect(isImportablePath('.Git/notes.md')).toBe(false);
    expect(isImportablePath('Dist/out.md')).toBe(false);
  });

  it('refuses a non-markdown extension, however it is dressed up', () => {
    expect(isImportablePath('.env')).toBe(false);
    expect(isImportablePath('src/index.ts')).toBe(false);
    expect(isImportablePath('secrets')).toBe(false);
    expect(isImportablePath('README.md.txt')).toBe(false);
  });

  it('refuses an absolute path and any traversal, before the filesystem is asked', () => {
    expect(isImportablePath('/etc/passwd')).toBe(false);
    expect(isImportablePath('../outside.md')).toBe(false);
    expect(isImportablePath('docs/../../outside.md')).toBe(false);
    expect(isImportablePath('./docs/PRD.md')).toBe(false);
    expect(isImportablePath('')).toBe(false);
  });
});

describe('test_context_tokens', () => {
  it('prices each body with the injected tokenizer and counts bytes as UTF-8', () => {
    const at = new Date('2026-08-22T10:00:00.000Z');
    const priced = tokenCountsFor(
      [
        { id: 'd1', name: 'a.md', body: 'one two three', updatedAt: at },
        { id: 'd2', name: 'b.md', body: 'привіт', updatedAt: at },
      ],
      wordCounter,
    );

    expect(priced[0]).toEqual({
      id: 'd1',
      name: 'a.md',
      bytes: 13,
      tokens: 3,
      updated_at: '2026-08-22T10:00:00.000Z',
    });
    // Bytes, not characters: six Cyrillic code points are twelve UTF-8 bytes,
    // and the size bounds are about storage.
    expect(priced[1]!.bytes).toBe(12);
  });
});

describe('test_context_ordering', () => {
  const doc = (id: string, name: string) => ({ id, name, body: `body of ${name}` });

  it('orders the slot alphabetically by name, whatever order the joins returned', () => {
    const ordered = orderedSpecs(
      [doc('1', 'zulu.md'), doc('2', 'alpha.md')],
      [doc('3', 'mike.md')],
    );
    expect(ordered.map((d) => d.name)).toEqual(['alpha.md', 'mike.md', 'zulu.md']);
  });

  it('deduplicates by document id, so one document attached twice appears once', () => {
    // The exact case AC-31 names: the same document attached to an agent AND to
    // one of that agent's skills. Two rows, one document, one block.
    const ordered = orderedSpecs([doc('1', 'shared.md')], [doc('1', 'shared.md')]);
    expect(ordered).toHaveLength(1);
  });

  it('does NOT deduplicate two different documents that share a name', () => {
    // Deduplicating by name would merge them, which is a different and much
    // stronger claim than "this is the same row twice".
    const ordered = orderedSpecs([doc('1', 'PRD.md')], [doc('2', 'PRD.md')]);
    expect(ordered.map((d) => d.id)).toEqual(['1', '2']);
  });
});

import type { ImportCandidate, ImportCandidates, ImportSkipReason } from '@devdigest/shared';
import { EXCLUDED_DIRS } from '../../platform/source-scope.js';
import { CONTEXT_DOC_EXTENSIONS, MAX_DOC_BYTES } from './constants.js';

/**
 * Pure rules of the project-context store: which candidates are offered, why one
 * is refused, what a document costs in tokens, and in what order bodies enter
 * the prompt.
 *
 * Every function here is a calculation over data already in memory — no database,
 * no filesystem, no model. That is the placement rule (SQL → `repository.ts`,
 * orchestration → `service.ts`, calculation → here), and it is also what lets
 * these be tested without Docker while the rest of the module cannot be.
 */

/** What the walk found about one file, before it becomes a candidate. */
export interface ScannedFile {
  bytes: number;
  /**
   * `true` when the file could not be read, or was not valid UTF-8.
   *
   * A BOOLEAN, not the text. Retaining every candidate's body — up to
   * `MAX_LISTED_DOCS` of them — to answer one yes/no question is how a hostile
   * clone exhausts the heap through a read-only endpoint. Nothing downstream of
   * the scan needs the text; the import reads the one file that was chosen.
   */
  unreadable: boolean;
}

/**
 * May this path be imported at all?
 *
 * **One rule, shared by the picker and the create path, and that sharing is the
 * whole point.** `list()` filters by extension and skips `EXCLUDED_DIRS`, so the
 * picker never offers `.git/config`. The create endpoint takes a path from the
 * REQUEST BODY, and before this function existed it applied neither check — so
 * `{"kind":"import","path":".git/config"}` read a file the picker would never
 * show. That file holds the clone URL, and `repos/helpers.ts` embeds the GitHub
 * token in it as a password: the secret came back in the response, went into
 * `context_docs.body`, and would have been sent to a model provider. It is a
 * direct breach of this repo's "secrets never touch the DB or git" invariant,
 * and it existed because two code paths applied two different rules to the same
 * input.
 *
 * Lexical only, and deliberately so — it decides whether a path is OFFERABLE,
 * which is a question about the path. Whether it stays inside the clone is a
 * question about the filesystem, and `FsSourceReader` answers that one with
 * `realpath`.
 */
export function isImportablePath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/')) return false;
  const segments = path.split('/');
  if (segments.includes('..') || segments.includes('.')) return false;
  // CASE-INSENSITIVE, and on this repo's primary platform that is the whole
  // point rather than politeness: macOS filesystems are case-insensitive by
  // default, so `Vendor/x.md` and `NODE_MODULES/x.md` open the very files this
  // list exists to keep out. A case-sensitive comparison against a lowercase
  // list is an exclusion that does not hold on the machine most of this is
  // written on. `list()` is unaffected — it matches the real dirent name — so
  // this only ever mattered for a path that arrived in a request body.
  if (segments.some((seg) => EXCLUDED.has(seg.toLowerCase()))) return false;
  const name = segments[segments.length - 1] ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return false;
  return CONTEXT_DOC_EXTENSIONS.includes(name.slice(dot).toLowerCase());
}

/** `EXCLUDED_DIRS`, lowercased once, for the comparison above. */
const EXCLUDED = new Set<string>(EXCLUDED_DIRS.map((d) => d.toLowerCase()));

/**
 * The Unicode replacement character. `readFile(…, 'utf8')` does not throw on
 * invalid bytes — it substitutes this — so its PRESENCE is the only signal that
 * a file was not UTF-8, and a check for a thrown error would never fire.
 */
export const REPLACEMENT_CHAR = '\uFFFD';

/** Did decoding this file produce replacement characters — i.e. was it not UTF-8? */
export function looksBinary(decoded: string): boolean {
  return decoded.includes(REPLACEMENT_CHAR);
}

/**
 * Why this file cannot be imported, or `undefined` when it can.
 *
 * Checked in order of how much we know: a path we would never offer is refused
 * before anything is read, and a file we could not read cannot also be judged
 * too large. `too_large` is checked BEFORE `not_utf8` because size is known from
 * the directory entry while UTF-8 validity is not — so an oversized file is
 * never decoded to find out what kind of oversized file it is.
 */
export function skipReasonFor(
  path: string,
  bytes: number,
  scanned: Pick<ScannedFile, 'unreadable'>,
): ImportSkipReason | undefined {
  if (!isImportablePath(path)) return 'outside_clone';
  if (bytes > MAX_DOC_BYTES) return 'too_large';
  if (scanned.unreadable) return 'not_utf8';
  return undefined;
}

/**
 * Turn the walk's paths into the picker's candidate list.
 *
 * Sorted, then capped — so the same first N appear on every rescan rather than
 * whatever the filesystem happened to enumerate first. A skipped file stays in
 * the list WITH its reason instead of vanishing: "my file is not here" is a
 * question the picker should answer, not raise.
 *
 * `truncated` is the OR of the incoming flag (the walk hit its own cap) and this
 * cap biting, because either one means the same thing to a reader: there is more
 * than you are being shown.
 */
export function candidatesFrom(
  paths: string[],
  scanned: Map<string, ScannedFile>,
  opts: { maxEntries: number; truncated: boolean },
): ImportCandidates {
  const sorted = [...new Set(paths)].sort();
  const kept = sorted.slice(0, opts.maxEntries);

  const candidates: ImportCandidate[] = kept.map((path) => {
    const file = scanned.get(path) ?? { bytes: 0, unreadable: true };
    const reason = skipReasonFor(path, file.bytes, file);
    // Built as one arm or the other rather than a conditional spread: the
    // contract is a discriminated union, so "skipped with no reason" is not a
    // shape this function can produce even by accident.
    return reason === undefined
      ? { path, bytes: file.bytes, status: 'ok' as const }
      : { path, bytes: file.bytes, status: 'skipped' as const, reason };
  });

  return { candidates, truncated: opts.truncated || sorted.length > opts.maxEntries };
}

/** Anything with a body we can price. Deliberately structural, not a row type. */
export interface Countable {
  id: string;
  name: string;
  body: string;
  updatedAt: Date;
}

/**
 * Price each document with the injected tokenizer.
 *
 * Reporting, never a gate: `Tokenizer.count` falls back to `ceil(chars/4)` and
 * never throws, so a missing encoder degrades the number on screen rather than
 * failing a page or a review.
 */
export function tokenCountsFor(
  docs: Countable[],
  tokenizer: { count(text: string): number },
): Array<{ id: string; name: string; bytes: number; tokens: number; updated_at: string }> {
  return docs.map((d) => ({
    id: d.id,
    name: d.name,
    bytes: Buffer.byteLength(d.body, 'utf8'),
    tokens: tokenizer.count(d.body),
    updated_at: d.updatedAt.toISOString(),
  }));
}

/**
 * The order and the identity of what enters the prompt's `specs` slot.
 *
 * Alphabetical by name so two runs of the same configuration assemble the same
 * prompt — an order that depends on insertion or on join order makes two traces
 * incomparable for no benefit.
 *
 * Deduplicated by document ID, not by name or body: a document attached to BOTH
 * an agent and one of that agent's skills is one document and must appear once.
 * Deduplicating by name would additionally merge two genuinely different
 * documents that happen to share a name across repos, which is not the same
 * claim and not one this function is entitled to make.
 */
export function orderedSpecs<T extends { id: string; name: string }>(
  agentDocs: T[],
  skillDocs: T[],
): T[] {
  const byId = new Map<string, T>();
  for (const doc of [...agentDocs, ...skillDocs]) {
    if (!byId.has(doc.id)) byId.set(doc.id, doc);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

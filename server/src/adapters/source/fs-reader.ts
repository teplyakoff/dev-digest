import { readFile } from 'node:fs/promises';
import { isAbsolute, join, normalize, sep } from 'node:path';
import type { SourceReader } from '@devdigest/shared';

/**
 * The filesystem implementation of `SourceReader` — reads one repo-relative
 * file out of a clone.
 *
 * Everything that could go wrong answers `null`, because every caller treats a
 * file it cannot read as data rather than as a failure: a config that isn't in
 * this repo, a sample file that moved since the index was built. Throwing would
 * mean every call site wraps it in a try/catch that discards the error, which is
 * the same behaviour with more code.
 */
export class FsSourceReader implements SourceReader {
  async read(clonePath: string, relPath: string): Promise<string | null> {
    const safe = containedPath(clonePath, relPath);
    if (safe === null) return null;
    // Covers ENOENT, EISDIR, EACCES and a binary file that isn't valid UTF-8 —
    // all of which mean the same thing to a caller: no text here.
    return readFile(safe, 'utf8').catch(() => null);
  }
}

/**
 * Resolve `relPath` inside `clonePath`, or `null` when it would escape.
 *
 * Normalising BEFORE the prefix check is the whole point: `a/../../etc/passwd`
 * only reveals itself as an escape once the `..` segments are collapsed, and a
 * check on the raw string would pass it. The trailing separator on the prefix
 * matters too — without it a clone at `/repos/app` would accept a path resolving
 * into the sibling directory `/repos/app-evil`.
 */
function containedPath(clonePath: string, relPath: string): string | null {
  if (relPath.length === 0 || isAbsolute(relPath)) return null;
  const root = normalize(clonePath);
  const resolved = normalize(join(root, relPath));
  const prefix = root.endsWith(sep) ? root : root + sep;
  return resolved.startsWith(prefix) ? resolved : null;
}

import { readFile, realpath } from 'node:fs/promises';
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
    // Lexical check first: it costs nothing and rejects the obvious escapes
    // before any syscall.
    if (containedPath(clonePath, relPath) === null) return null;

    // Then the real one. A lexical check cannot see a SYMLINK: a repo is
    // untrusted content, and one that ships `tsconfig.json` as a link to
    // /etc/passwd passes every string test there is. Resolving both sides and
    // re-checking is what actually enforces the root — the file's contents go
    // into a model prompt and onto the Conventions page as verified "evidence",
    // so this is an exfiltration path, not a tidiness rule.
    //
    // The ROOT is resolved too, and that is not belt-and-braces: clone
    // directories routinely sit under a symlinked prefix (on macOS /tmp is a
    // link to /private/tmp), so comparing a resolved target against an
    // unresolved root would reject every legitimate read there.
    const [realRoot, realTarget] = await Promise.all([
      realpath(clonePath).catch(() => null),
      realpath(join(clonePath, relPath)).catch(() => null),
    ]);
    if (realRoot === null || realTarget === null) return null;
    if (!contains(realRoot, realTarget)) return null;

    // Covers ENOENT, EISDIR, EACCES and a binary file that isn't valid UTF-8 —
    // all of which mean the same thing to a caller: no text here.
    return readFile(realTarget, 'utf8').catch(() => null);
  }
}

/**
 * Resolve `relPath` inside `clonePath` lexically, or `null` when it would
 * escape.
 *
 * Normalising BEFORE the prefix check is the whole point: `a/../../etc/passwd`
 * only reveals itself as an escape once the `..` segments are collapsed, and a
 * check on the raw string would pass it.
 */
function containedPath(clonePath: string, relPath: string): string | null {
  if (relPath.length === 0 || isAbsolute(relPath)) return null;
  const root = normalize(clonePath);
  const resolved = normalize(join(root, relPath));
  return contains(root, resolved) ? resolved : null;
}

/**
 * Is `target` inside `root`?
 *
 * The trailing separator on the prefix is load-bearing — without it a clone at
 * `/repos/app` would accept a path resolving into the sibling directory
 * `/repos/app-evil`.
 */
function contains(root: string, target: string): boolean {
  const prefix = root.endsWith(sep) ? root : root + sep;
  return target.startsWith(prefix);
}

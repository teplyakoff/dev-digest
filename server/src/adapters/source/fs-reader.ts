import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import type { SourceReader } from '@devdigest/shared';
import { EXCLUDED_DIRS } from '../../platform/source-scope.js';

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

  async list(
    clonePath: string,
    opts: { extensions: string[]; maxEntries: number },
  ): Promise<{ entries: Array<{ path: string; bytes: number }>; truncated: boolean }> {
    // Resolve the root once. Every entry is compared against THIS, not against
    // the string we were handed — clone directories routinely sit under a
    // symlinked prefix (on macOS /tmp is a link to /private/tmp), so an
    // unresolved root would reject every legitimate entry.
    const realRoot = await realpath(clonePath).catch(() => null);
    if (realRoot === null) return { entries: [], truncated: false };

    const wanted = new Set(opts.extensions.map((e) => e.toLowerCase()));
    const excluded = new Set<string>(EXCLUDED_DIRS);
    const found = new Map<string, number>();

    // Iterative rather than recursive: a clone is untrusted content, and a
    // symlink loop that survives the containment check below would still blow
    // the call stack. A queue cannot.
    const queue: string[] = [realRoot];
    while (queue.length > 0) {
      const dir = queue.pop()!;
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
      // An unreadable subdirectory is skipped, not fatal: one EACCES deep in a
      // clone must not empty the whole picker.
      if (entries === null) continue;

      for (const entry of entries) {
        const abs = join(dir, entry.name);

        // `isDirectory()` is false for a symlink, so a symlinked DIRECTORY is
        // never descended into at all. That is deliberate and conservative: the
        // in-clone case it costs us is rare, and the out-of-clone case it
        // removes is the whole traversal surface of a walk.
        if (entry.isDirectory()) {
          if (excluded.has(entry.name)) continue;
          queue.push(abs);
          continue;
        }

        // `isFile()` is false for a symlink, so a link to a file is resolved by
        // the realpath check below rather than skipped here.
        if (!wanted.has(extname(entry.name).toLowerCase())) continue;

        // The per-entry containment check. `read()` refuses to be talked out of
        // its root; a `list()` that did not do the same would let a symlinked
        // file or directory walk the caller straight out of the clone and then
        // hand those paths back to be read.
        const realTarget = await realpath(abs).catch(() => null);
        if (realTarget === null || !contains(realRoot, realTarget)) continue;

        // The size comes from the directory entry, never from reading the file:
        // this is the number a caller uses to REFUSE an oversized document, so
        // obtaining it must not be the thing that loads it.
        const info = await stat(realTarget).catch(() => null);
        if (info === null) continue;

        // A Map deduplicates by resolved path, because two symlinks can point
        // at one real file and the picker must offer it once.
        found.set(toPosix(relative(realRoot, realTarget)), info.size);
      }
    }

    // Sort first, cap second — see the port's doc comment.
    const sorted = [...found.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return {
      entries: sorted.slice(0, opts.maxEntries).map(([path, bytes]) => ({ path, bytes })),
      truncated: sorted.length > opts.maxEntries,
    };
  }
}

/** Repo-relative paths are forward-slash everywhere, including on Windows. */
function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
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

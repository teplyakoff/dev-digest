import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsSourceReader } from '../src/adapters/source/fs-reader.js';

/**
 * The `SourceReader` port's filesystem adapter.
 *
 * Two properties, and the second is the one worth a test: every failure reads as
 * `null` (callers treat an unreadable file as data, not as an error), and a path
 * cannot leave the clone. No caller passes an untrusted path today — the model
 * only ever names files it was shown — but a port that can be talked out of its
 * own root is a traversal waiting for its first careless caller.
 */

let root: string;
let outside: string;
const reader = new FsSourceReader();

beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'devdigest-source-'));
  root = join(base, 'clone');
  outside = base;
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'a.ts'), 'const a = 1;\n', 'utf8');
  // The `.md` corpus the import picker walks, plus the two shapes it must not
  // offer: a file under an EXCLUDED_DIRS directory, and a non-`.md` sibling.
  await mkdir(join(root, 'docs'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(join(root, 'README.md'), '# readme\n', 'utf8');
  await writeFile(join(root, 'docs', 'PRD.md'), '# prd\n', 'utf8');
  await writeFile(join(root, 'docs', 'notes.txt'), 'not markdown\n', 'utf8');
  await writeFile(join(root, 'node_modules', 'pkg', 'VENDORED.md'), '# vendored\n', 'utf8');
  await writeFile(join(outside, 'stolen.md'), '# outside the clone\n', 'utf8');
  await writeFile(join(outside, 'secret.txt'), 'do not read me', 'utf8');
  // A sibling whose name starts with the clone's — the case a naive prefix
  // check without a trailing separator would wave through.
  await mkdir(`${root}-evil`, { recursive: true });
  await writeFile(join(`${root}-evil`, 'b.ts'), 'stolen', 'utf8');
  // What a hostile repo actually ships: a file with an expected name whose
  // contents live outside the clone. Every string-level check passes it.
  await symlink(join(outside, 'secret.txt'), join(root, 'tsconfig.json'));
  await symlink(outside, join(root, 'escape-dir'));
  // A `.md` symlink pointing out of the clone — the entry `list` must drop even
  // though its name and extension are exactly what the picker is looking for.
  await symlink(join(outside, 'stolen.md'), join(root, 'docs', 'LINKED.md'));
});

afterAll(async () => {
  await rm(outside, { recursive: true, force: true });
  await rm(`${root}-evil`, { recursive: true, force: true });
});

describe('FsSourceReader', () => {
  it('reads a repo-relative file', async () => {
    expect(await reader.read(root, 'src/a.ts')).toBe('const a = 1;\n');
  });

  it('answers null for a file that is not there', async () => {
    expect(await reader.read(root, 'src/missing.ts')).toBeNull();
  });

  it('answers null for a directory', async () => {
    expect(await reader.read(root, 'src')).toBeNull();
  });

  it('refuses to escape the clone with ..', async () => {
    expect(await reader.read(root, '../secret.txt')).toBeNull();
    // Only visible as an escape once the segments are collapsed — a check on the
    // raw string would pass this one.
    expect(await reader.read(root, 'src/../../secret.txt')).toBeNull();
  });

  it('refuses an absolute path', async () => {
    expect(await reader.read(root, join(outside, 'secret.txt'))).toBeNull();
  });

  it('refuses a sibling directory that merely shares the clone name prefix', async () => {
    expect(await reader.read(root, '../clone-evil/b.ts')).toBeNull();
  });

  it('refuses an empty path', async () => {
    expect(await reader.read(root, '')).toBeNull();
  });

  it('allows . and .. that stay inside', async () => {
    expect(await reader.read(root, './src/a.ts')).toBe('const a = 1;\n');
    expect(await reader.read(root, 'src/../src/a.ts')).toBe('const a = 1;\n');
  });

  it('refuses a SYMLINK that points outside the clone', async () => {
    // The case a lexical check cannot see, and the one that matters: a repo is
    // untrusted content, `tsconfig.json` is a name the config allowlist asks
    // for by default, and whatever it resolves to would reach a model prompt
    // and the Conventions page as verified "evidence".
    expect(await reader.read(root, 'tsconfig.json')).toBeNull();
  });

  it('refuses a path that traverses a symlinked directory out of the clone', async () => {
    expect(await reader.read(root, 'escape-dir/secret.txt')).toBeNull();
  });

  it('still reads normally when the clone root is itself behind a symlink', async () => {
    // Not hypothetical: on macOS /tmp is a link to /private/tmp, so resolving
    // the target without also resolving the root would reject every read here.
    expect(await reader.read(root, 'src/a.ts')).toBe('const a = 1;\n');
  });
});

/**
 * `list` — the directory walk added for SPEC-06's import picker.
 *
 * The reversal of `04-conventions.md:236-238` is recorded in the port's doc
 * comment; what is tested here is that it did not arrive weaker than `read`.
 * `read` refuses to be talked out of its root, so a `list` that can be walked out
 * of it on a symlinked directory would hand the caller paths it will then read —
 * defeating the check by going around it rather than through it.
 */
describe('FsSourceReader.list', () => {
  const md = { extensions: ['.md'], maxEntries: 100 };

  it('returns sorted, forward-slash, repo-relative paths with their sizes', async () => {
    const { entries, truncated } = await reader.list(root, md);
    expect(entries.map((e) => e.path)).toEqual(['README.md', 'docs/PRD.md']);
    expect(truncated).toBe(false);
    // The size comes from the directory entry, not from reading the file — it is
    // what lets a caller refuse an oversized document without holding it.
    expect(entries[0]!.bytes).toBe('# readme\n'.length);
  });

  it('walks past EXCLUDED_DIRS rather than filtering their contents afterwards', async () => {
    const { entries } = await reader.list(root, md);
    expect(entries.some((e) => e.path.startsWith('node_modules/'))).toBe(false);
  });

  it('drops a symlinked entry that resolves outside the clone', async () => {
    // Same attack as the `read` case above, arriving through the other method.
    const { entries } = await reader.list(root, md);
    expect(entries.map((e) => e.path)).not.toContain('docs/LINKED.md');
  });

  it('caps at maxEntries and says the cap bit', async () => {
    const { entries, truncated } = await reader.list(root, { extensions: ['.md'], maxEntries: 1 });
    // Sorted BEFORE the cap, so the cap always returns the same first N rather
    // than whatever the filesystem happened to hand back first.
    expect(entries.map((e) => e.path)).toEqual(['README.md']);
    expect(truncated).toBe(true);
  });

  it('answers an empty list, and does not throw, for a root that is not there', async () => {
    const { entries, truncated } = await reader.list(join(outside, 'no-such-clone'), md);
    expect(entries).toEqual([]);
    expect(truncated).toBe(false);
  });
});

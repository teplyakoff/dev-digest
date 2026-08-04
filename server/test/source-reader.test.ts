import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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
  await writeFile(join(outside, 'secret.txt'), 'do not read me', 'utf8');
  // A sibling whose name starts with the clone's — the case a naive prefix
  // check without a trailing separator would wave through.
  await mkdir(`${root}-evil`, { recursive: true });
  await writeFile(join(`${root}-evil`, 'b.ts'), 'stolen', 'utf8');
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
});

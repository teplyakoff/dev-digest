/**
 * repo-intel pipeline — walk + filter (step 1+2).
 *
 * Walks a clone directory and returns the set of files the parse phase should
 * process, applying:
 *   - EXCLUDED_DIRS  (node_modules, dist, build, coverage, .next, out, vendor, .git)
 *   - SUPPORTED_EXT  (.ts, .tsx, .js, .jsx, .mjs, .cjs)
 *   - MAX_FILE_SIZE  (400 KB) — files larger than this are counted in
 *                    `stats.skippedTooLarge` and left out of the result.
 *   - MAX_INDEXED_FILES (5000) — if exceeded, take the FIRST N (by walk order)
 *                    and record `stats.bounded = total - N`. T3 will replace
 *                    "first N" with "top N by hotness" once `file_rank` lands.
 *
 * NOT YET HANDLED:
 *   - `.gitignore` filtering. Would require the `ignore` npm package; the
 *     EXCLUDED_DIRS list covers the heaviest dirs (node_modules, build outputs),
 *     so the practical loss is small. TODO(T3): wire `ignore` once we accept
 *     a new dep, OR honor `git ls-files` so we get .gitignore for free.
 *
 * Pure-ish: takes a root path + does fs ops; returns plain data so the caller
 * (full.ts / incremental.ts) can decide what to do with it.
 */
// KNOWN DEBT. Ring-2 code should reach the filesystem through a port
// (onion §3, §7), and it does not: the repo-intel indexer reads cloned files
// directly. Extracting a `SourceReader` port is a real piece of work — one
// interface, one adapter, one test double, one container key — and doing it
// half-way is worse than not starting, so it is deliberately NOT bundled into
// this change. Payoff when it happens: repo-intel tests stop needing a clone.
// eslint-disable-next-line no-restricted-imports
import { readdir, stat } from 'node:fs/promises';
// Same SourceReader debt as above.
// eslint-disable-next-line no-restricted-imports
import type { Dirent } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { MAX_FILE_SIZE, MAX_INDEXED_FILES } from '../constants.js';
import { EXCLUDED_DIRS, SUPPORTED_EXT } from '../../../platform/source-scope.js';

const EXCLUDED_SET: ReadonlySet<string> = new Set(EXCLUDED_DIRS);
const SUPPORTED_SET: ReadonlySet<string> = new Set(SUPPORTED_EXT);

export interface WalkStats {
  /** Files seen on disk with a SUPPORTED_EXT extension (before size + bound filters). */
  totalCandidates: number;
  /** Candidates dropped because stat().size > MAX_FILE_SIZE. */
  skippedTooLarge: number;
  /** Candidates dropped because the file list exceeded MAX_INDEXED_FILES. */
  bounded: number;
}

export interface WalkResult {
  /** Paths relative to `root`, separator-normalized to forward slashes. */
  files: string[];
  stats: WalkStats;
}

/**
 * Recursively walk `root`, returning the file set to parse + a small stats
 * object the pipeline persists into `repo_index_state.stats`.
 */
export async function walkClone(root: string): Promise<WalkResult> {
  const out: string[] = [];
  const stats: WalkStats = { totalCandidates: 0, skippedTooLarge: 0, bounded: 0 };

  await walkDir(root, root, out, stats);

  // Stable order: alphabetical relpath. Keeps "first N when bounded" reproducible
  // across runs (until T3 replaces it with rank-driven selection).
  out.sort();

  if (out.length > MAX_INDEXED_FILES) {
    stats.bounded = out.length - MAX_INDEXED_FILES;
    out.length = MAX_INDEXED_FILES;
  }

  return { files: out, stats };
}

async function walkDir(
  root: string,
  dir: string,
  out: string[],
  stats: WalkStats,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    // Unreadable directory (permissions, dangling symlink) — skip cleanly so
    // the indexer keeps making progress on the parts of the clone it CAN read.
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // never follow symlinks (loops, perf)
    const name = entry.name;

    if (entry.isDirectory()) {
      if (EXCLUDED_SET.has(name)) continue;
      await walkDir(root, join(dir, name), out, stats);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = extname(name).toLowerCase();
    if (!SUPPORTED_SET.has(ext)) continue;

    stats.totalCandidates += 1;

    const full = join(dir, name);
    let size: number;
    try {
      size = (await stat(full)).size;
    } catch {
      continue;
    }
    if (size > MAX_FILE_SIZE) {
      stats.skippedTooLarge += 1;
      continue;
    }

    // Posix-style relative path so DB rows are platform-agnostic (matches the
    // `pr_files.path` convention).
    const rel = relative(root, full).split(sep).join('/');
    out.push(rel);
  }
}

import type { Container } from '../../platform/container.js';
import type { RepoRef, UnifiedDiff } from '@devdigest/shared';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import type { ReviewRepository, PullRow } from './repository.js';

/** The three fields `loadDiff` reads off a PR row. */
export type DiffPullRef = Pick<PullRow, 'id' | 'base' | 'headSha'>;

/**
 * Load the unified diff for a PR. Prefers a real `git diff base...head`; falls
 * back to assembling a synthetic unified diff from the persisted pr_files
 * patches (so the reviewer works even before a clone completes / in tests).
 *
 * The two row parameters are STRUCTURAL, not ORM rows. This file used to carry
 * an `eslint-disable no-restricted-imports` for a type-position
 * `db/schema` import, whose standing instruction was "the next person to change
 * this signature should prefer a contract type" (onion §15). L03 changed the
 * signature — `container.loadPrDiff` now hands the same call to a second
 * feature — so the instruction was taken and the exemption is gone.
 *
 * Narrowing is what keeps the ring-2 ban enforceable: with `repoRow` typed as
 * `typeof repos.$inferSelect`, any ring-2 caller reached through the container
 * depended on an ORM row shape WITHOUT importing `db/schema`, so
 * `eslint.config.js`'s rule structurally could not fire on it.
 */
export async function loadDiff(
  container: Container,
  repo: ReviewRepository,
  workspaceId: string,
  pull: DiffPullRef,
  repoRow: RepoRef,
): Promise<UnifiedDiff> {
  try {
    const diff = await container.git.diff(
      { owner: repoRow.owner, name: repoRow.name },
      pull.base,
      pull.headSha,
    );
    if (diff.files.length > 0) return diff;
  } catch {
    /* fall through to pr_files reconstruction */
  }
  return diffFromPrFiles(repo, pull.id);
}

/** Reconstruct a UnifiedDiff from persisted pr_files patches. */
export async function diffFromPrFiles(repo: ReviewRepository, prId: string): Promise<UnifiedDiff> {
  const files = await repo.getPrFiles(prId);
  const parts: string[] = [];
  for (const f of files) {
    if (!f.patch) continue;
    parts.push(`diff --git a/${f.path} b/${f.path}`);
    parts.push(`--- a/${f.path}`);
    parts.push(`+++ b/${f.path}`);
    parts.push(f.patch);
  }
  return parseUnifiedDiff(parts.join('\n'));
}

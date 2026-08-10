import type { PrFile, SmartDiff, SmartDiffFile } from "@devdigest/shared";

/** The numbers in the summary strip — all four are computed, never stored. */
export interface DiffTotals {
  files: number;
  additions: number;
  deletions: number;
  findings: number;
  /** `additions + deletions` over every file, not `split_suggestion.total_lines`
      — the strip describes what is on screen. */
  lines: number;
}

export function totalsFor(data: SmartDiff): DiffTotals {
  const totals: DiffTotals = { files: 0, additions: 0, deletions: 0, findings: 0, lines: 0 };
  for (const group of data.groups) {
    for (const file of group.files) {
      totals.files += 1;
      totals.additions += file.additions;
      totals.deletions += file.deletions;
      totals.findings += file.findings.length;
      totals.lines += file.additions + file.deletions;
    }
  }
  return totals;
}

/* Group ORDER is not computed here. `data.groups` arrives already ordered
   core → wiring → boilerplate, with empty groups omitted, and the viewer renders
   it as sent — see the note on that in `SmartDiffViewer.tsx`. A re-sort here
   would be a second source of truth for the feature's central promise
   ("business logic first") that could drift from the server's without either
   side failing. */

/**
 * `SmartDiff` carries no patch text — it is computed from `pr_files` metadata
 * plus findings — so the diff body still comes from the PR detail the page
 * already fetched. Indexed by path once per render rather than scanned per file.
 */
export function patchIndex(files: PrFile[]): Map<string, string | null | undefined> {
  return new Map(files.map((f) => [f.path, f.patch]));
}

/**
 * The `PrFile` the shared `FileCard` renders, assembled from the Smart Diff row
 * plus that file's patch. A path with no matching PR file gets `patch: null`,
 * which `FileCard` already renders as "no diff text" — the same state every
 * seeded PR is in.
 */
export function toPrFile(
  file: SmartDiffFile,
  patches: Map<string, string | null | undefined>,
): PrFile {
  return {
    path: file.path,
    additions: file.additions,
    deletions: file.deletions,
    patch: patches.get(file.path) ?? null,
  };
}

import type { ConventionCandidate, ConventionScan } from "@devdigest/shared";
import { githubBlobUrl } from "../../../../lib/github-urls";

/** Pure helpers for the Conventions page. */

/**
 * The GitHub permalink for a candidate's evidence.
 *
 * Pinned to the scan's `indexed_sha` — the commit the sample was READ at — so
 * the highlighted lines still hold the code the snippet shows after the branch
 * moves on. Linking to a branch would drift the moment anyone pushes, and the
 * snippet on screen would start disagreeing with the page it links to.
 *
 * Returns null when the pieces are not there (no scan yet, or a repo whose
 * full name has not loaded), so the caller renders plain text rather than a
 * broken link.
 */
export function evidenceUrl(
  candidate: ConventionCandidate,
  scan: ConventionScan | null | undefined,
  repoFullName: string | null | undefined,
): string | null {
  if (!scan?.indexed_sha || !repoFullName || !candidate.evidence_path) return null;
  return githubBlobUrl(
    repoFullName,
    scan.indexed_sha,
    candidate.evidence_path,
    candidate.evidence_start_line,
    candidate.evidence_end_line,
  );
}

/** `src/api/users.ts:14-20`, or just `:14` when the span is one line. */
export function evidenceLabel(candidate: ConventionCandidate): string {
  const { evidence_path: path, evidence_start_line: start, evidence_end_line: end } = candidate;
  return start === end ? `${path}:${start}` : `${path}:${start}-${end}`;
}

/**
 * The drop breakdown as `reason × n`, most casualties first.
 *
 * Surfaced rather than logged because the drop rate IS the extractor's
 * credibility: a scan that proposed 12 and kept 3 is telling you something about
 * the model, and hiding it would make the kept three look better than they are.
 */
export function dropSummary(scan: ConventionScan): string[] {
  const counts = new Map<string, number>();
  for (const d of scan.dropped) counts.set(d.reason, (counts.get(d.reason) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${reason} × ${n}`);
}

export function acceptedCount(candidates: readonly ConventionCandidate[]): number {
  return candidates.filter((c) => c.status === "accepted").length;
}

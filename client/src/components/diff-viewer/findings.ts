/* Smart-Diff finding support for the DiffViewer's FileCard/CodeLine.
   Pure helpers + the capability shape a caller opts into; the React bits live in
   FileCard.tsx / CodeLine.tsx and the styles in ./styles.ts.

   Sits beside `comments.ts` and mirrors it deliberately: findings are the second
   thing that anchors to a diff line, and the two partition the same way. No
   barrel — import this module by path (frontend-architecture §12).

   `DiffViewer.tsx` deliberately does NOT thread any of this through. The Files
   tab's ORIGINAL mode renders `DiffViewer`, which has no way to receive
   findings, so "findings are invisible in original mode" is a property of the
   type system rather than a runtime flag someone can flip by accident. */
import type { Severity, SmartDiffFinding } from "../../lib/types";
import type { Line } from "./helpers";

/**
 * What one file's Smart-Diff overlay needs. Optional on `FileCard`, mirroring
 * `commenting?: DiffCommentApi` — a capability the caller opts into, not a mode
 * the card can be in.
 */
export interface SmartFileView {
  /** This file's findings only — the caller has already narrowed by path. */
  findings: SmartDiffFinding[];
  /** `additions + deletions > LARGE_FILE_LINES`, decided by the server. */
  isLarge: boolean;
  /** Overrides the card's own `AUTO_EXPAND_MAX_LINES` rule (role policy wins). */
  defaultOpen: boolean;
  onOpenFinding: (id: string) => void;
}

/**
 * Findings anchored to a given parsed line.
 *
 * Anchors on `ln.newNo`, and only for lines that are not deletions. That is
 * provable rather than assumed: `reviewer-core/src/grounding.ts:22` builds a
 * file → NEW-side line set and a diff-finding survives only if its
 * `[start_line, end_line]` intersects it, while the diff parser never assigns a
 * new-side number to a deletion — so a grounded diff-finding always lands on an
 * `add` or `ctx` line, both of which carry `newNo`.
 *
 * Note `CodeLine` renders `ln.newNo ?? ln.oldNo`, so a `del` row shows its OLD
 * number in the very same gutter. Never match on what the gutter displays.
 */
export function findingsForLine(
  ln: Line,
  byLine: Map<number, SmartDiffFinding[]>,
): SmartDiffFinding[] {
  if (byLine.size === 0 || ln.kind === "del" || ln.newNo == null) return [];
  return byLine.get(ln.newNo) ?? [];
}

/** The new-side line numbers a parsed patch actually renders. */
export function renderedLineNumbers(lines: Line[]): Set<number> {
  const out = new Set<number>();
  for (const ln of lines) {
    if (ln.kind !== "del" && ln.kind !== "hunk" && ln.newNo != null) out.add(ln.newNo);
  }
  return out;
}

/**
 * Split findings into ones that land on a rendered line and ones that cannot be
 * anchored, mirroring `partitionThreads` in `comments.ts`.
 *
 * This is NOT an edge case. Seeded PR files carry `patch: null`
 * (`server/INSIGHTS.md` 2026-07-28), so on seed data *every* finding is
 * unanchored and the fallback list is the only thing on screen. Findings of kind
 * `secret_leak` / `lethal_trifecta` / `phantom` / `hook` also bypass line
 * grounding entirely and can carry a line no rendered row matches. Nothing is
 * dropped silently either way.
 */
export function partitionFindings(
  findings: SmartDiffFinding[],
  renderedLines: Set<number>,
): { anchored: Map<number, SmartDiffFinding[]>; unanchored: SmartDiffFinding[] } {
  const anchored = new Map<number, SmartDiffFinding[]>();
  const unanchored: SmartDiffFinding[] = [];
  for (const f of findings) {
    if (renderedLines.has(f.line)) {
      const list = anchored.get(f.line) ?? [];
      list.push(f);
      anchored.set(f.line, list);
    } else {
      unanchored.push(f);
    }
  }
  return { anchored, unanchored };
}

/**
 * Rank for "which finding colours the rail" — lower wins.
 *
 * KEYED BY THE CONTRACT'S `Severity`, so this third copy of the ordering cannot
 * drift from the enum the other two follow. It already had: written as
 * `Record<string, number>` it carried an `INFO` member that
 * `vendor/shared/contracts/findings.ts` has never had — a rank for a severity no
 * server can send, while a real new member would have been missing here with
 * nothing to say so. Keyed by the type, both halves become compile errors.
 */
const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

/**
 * The finding a line's rail takes its colour from: the most severe one on the
 * line. A CRITICAL hidden behind a SUGGESTION because the server happened to
 * return it second is exactly the kind of silent downgrade the rail exists to
 * prevent.
 *
 * The `?? 9` both lookups used to carry is gone with the `string` key: an
 * exhaustive map cannot miss, and a fallback rank invented here is how the enum
 * drifts again without anyone noticing.
 */
export function mostSevere(findings: SmartDiffFinding[]): SmartDiffFinding | null {
  let worst: SmartDiffFinding | null = null;
  for (const f of findings) {
    if (worst == null || SEVERITY_RANK[f.severity] < SEVERITY_RANK[worst.severity]) {
      worst = f;
    }
  }
  return worst;
}

/**
 * The word on a finding's line tag. The design writes `CRITICAL` as "blocker"
 * and everything else lowercased — a severity name is a taxonomy label, but on a
 * code line the reader wants to know whether it stops the merge.
 */
export function severityTagLabel(severity: string): string {
  return severity === "CRITICAL" ? "blocker" : severity.toLowerCase();
}

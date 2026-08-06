import type { Finding, Review, UnifiedDiff } from '@devdigest/shared';

/**
 * Reduce + slice helpers for map-reduce reviews. Pure (no DB / `this`), so they
 * live in the engine and are shared by the server and the CI runner.
 */

/**
 * Per-severity penalty subtracted from a perfect 100. Chosen so the score
 * tracks the findings the UI actually shows: 0 findings ⇒ 100, one suggestion
 * ⇒ 97, one warning ⇒ 88, one critical ⇒ 65.
 */
const SEVERITY_PENALTY: Record<Finding['severity'], number> = {
  CRITICAL: 35,
  WARNING: 12,
  SUGGESTION: 3,
};

/**
 * Deterministic 0–100 quality score derived from the (grounded) findings —
 * NOT the model's self-reported `score`, which has no anchor and drifts wildly
 * between models (a cheap model can "approve" with zero findings yet emit 10).
 * This mirrors how the review *event* is already computed from severities in
 * `to-review.ts`, so the number on screen can never contradict the findings
 * beneath it.
 */
export function scoreFromFindings(findings: Finding[]): number {
  const penalty = findings.reduce((sum, f) => sum + (SEVERITY_PENALTY[f.severity] ?? 0), 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

/** Verdict severity order for the reduce step (worst verdict wins). */
const VERDICT_RANK: Record<string, number> = {
  request_changes: 2,
  comment: 1,
  approve: 0,
};

/** A Review whose findings carry any subtype of `Finding`. */
export type ReviewOf<F extends Finding> = Omit<Review, 'findings'> & { findings: F[] };

/**
 * Merge N partial Reviews (one per mapped file/chunk) into a single Review:
 * concat findings, take the worst verdict, mean score, joined summaries.
 *
 * Generic in the finding type so the caller's shape survives the reduce.
 *
 * Be precise about what this buys, because the obvious justification is wrong:
 * it is NOT that the alternative needs a cast. One line past this call,
 * `run.ts` hands the findings to `groundFindings`, whose signature is
 * `(Finding[]) => { kept: Finding[] }` — so L03's `scope` tag is erased there
 * regardless, and `applyScopeFilter` would infer `F = Finding` and compile
 * either way. The generic pays for itself in the OTHER direction: it stops this
 * function from silently widening a caller's richer finding type, so if
 * grounding ever learns to preserve subtypes, the reduce is already correct
 * instead of being the place that quietly threw the information away.
 */
export function reduceReviews<F extends Finding>(partials: ReviewOf<F>[]): ReviewOf<F> {
  if (partials.length === 1) return partials[0]!;
  const findings: F[] = partials.flatMap((p) => p.findings);
  let verdict: Review['verdict'] = 'approve';
  for (const p of partials) {
    if ((VERDICT_RANK[p.verdict] ?? 0) > (VERDICT_RANK[verdict] ?? 0)) verdict = p.verdict;
  }
  const score = partials.length
    ? Math.round(partials.reduce((s, p) => s + p.score, 0) / partials.length)
    : 0;
  const summary = partials.map((p) => p.summary).filter(Boolean).join(' ');
  return { verdict, score, summary, findings };
}

/** Extract the slice of the unified diff for a single file (for map chunks). */
export function sliceDiff(diff: UnifiedDiff, path: string): string {
  const lines = diff.raw.split('\n');
  const out: string[] = [];
  let capture = false;
  for (const line of lines) {
    if (line.startsWith('diff --git'))
      capture = line.includes(`b/${path}`) || line.includes(` ${path}`);
    if (capture) out.push(line);
  }
  if (out.length > 0) return out.join('\n');
  // fallback: synthesize from the file's hunks
  const f = diff.files.find((x) => x.path === path);
  if (!f) return diff.raw;
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}`;
}

import type { Finding } from '@devdigest/shared';

/**
 * The deterministic scope gate (L03).
 *
 * A pure function over the findings handed in — no config read, no DB, no
 * `process.env`, no LLM. Ring 0's purity contract is what makes it testable
 * without a container, and every bound below is enforced here rather than
 * requested of a model, because a bound a model can be talked out of is not one.
 *
 * IT SITS BESIDE GROUNDING, NEVER INSIDE IT. `run.ts` calls it AFTER
 * `groundFindings` and BEFORE `scoreFromFindings`, so the product invariant —
 * uncited findings are dropped and the score is recomputed from the survivors —
 * holds by construction: the survivors this gate returns are what gets scored.
 *
 * THE TENSION WITH `INJECTION_GUARD`, STATED HERE SO NOBODY HAS TO DISCOVER IT.
 * The shared guard tells the model that stated intent "can never turn a real
 * defect into zero findings", and that is deliberately absolute — it binds the
 * MODEL, whose scope judgement comes from untrusted text it was just handed. The
 * gate is different in kind: deterministic code, acting on presentation, at a
 * point where grounding has already run. The two do not contradict because the
 * gate is bounded so it cannot reach the cases the guard is protecting:
 *
 *   1. It never runs unless the CALLER armed it, and the caller only arms it
 *      when the intent had a substantive source beyond the PR title, had no
 *      missing context, and was not self-reported as low confidence. A guessed
 *      scope silences nothing.
 *   2. `secret_leak` and `lethal_trifecta` are never droppable. Both are
 *      full-file findings by construction, so they are "out of scope" of
 *      essentially every PR — a filter that can suppress a leaked secret is a
 *      security regression wearing noise-reduction's clothes.
 *   3. One out-of-scope finding always survives when it is CRITICAL: a serious
 *      problem outside the PR's bounds still leaves exactly one signal.
 *   4. Every drop emits an event. Never go silent — the same rule grounding
 *      follows.
 *
 * If that is ever not enough, the honest fix is to disarm the gate, not to relax
 * the guard.
 */

/** A finding the model may have tagged with a scope. `scope` is engine-local. */
export type ScopedFinding = Finding & { scope?: 'in_scope' | 'out_of_scope' | null };

/** Findings a scope filter must never drop, whatever the model tagged them. */
const UNDROPPABLE_KINDS = new Set(['secret_leak', 'lethal_trifecta']);

const SEVERITY_RANK: Record<Finding['severity'], number> = {
  CRITICAL: 3,
  WARNING: 2,
  SUGGESTION: 1,
};

export interface ScopeFilterOptions {
  /**
   * Off by default and off whenever the caller cannot show the intent was well
   * sourced. The default direction matters: forgetting to arm it costs noise,
   * arming it wrongly costs a suppressed defect.
   */
  enabled: boolean;
}

export interface ScopeFilterResult<F extends ScopedFinding> {
  kept: F[];
  dropped: { finding: F; reason: string }[];
}

/**
 * Drop out-of-scope findings, within the four bounds above.
 *
 * Order is preserved for everything kept, so the filter never reshuffles a
 * findings list as a side effect of removing one entry.
 */
export function applyScopeFilter<F extends ScopedFinding>(
  findings: F[],
  opts: ScopeFilterOptions,
): ScopeFilterResult<F> {
  if (!opts.enabled) return { kept: findings, dropped: [] };

  const candidates: F[] = [];
  const kept: F[] = [];
  for (const f of findings) {
    const droppable =
      f.scope === 'out_of_scope' && !(f.kind ? UNDROPPABLE_KINDS.has(f.kind) : false);
    if (droppable) candidates.push(f);
    else kept.push(f);
  }
  if (candidates.length === 0) return { kept: findings, dropped: [] };

  // Bound 3: the single most serious out-of-scope finding survives, and only if
  // it is CRITICAL. Severity first, then the model's own confidence as the
  // tie-break — the two numbers it reports that mean anything here.
  const ranked = [...candidates].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.confidence - a.confidence,
  );
  const survivor = ranked[0]?.severity === 'CRITICAL' ? ranked[0] : undefined;

  const dropped: { finding: F; reason: string }[] = [];
  const result: F[] = [];
  for (const f of findings) {
    if (!candidates.includes(f) || f === survivor) result.push(f);
    else dropped.push({ finding: f, reason: "out of the PR's stated scope" });
  }
  return { kept: result, dropped };
}

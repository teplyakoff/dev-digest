import type { IntentConfidence, IntentSource, PrIntentRecord } from '@devdigest/shared';
import { MAX_SCOPE_ITEM_CHARS, MAX_SCOPE_ITEMS } from './constants.js';
import type { PrIntentRow } from './repository.js';

/**
 * Pure functions over an intent record. No container, no DB, no I/O — testable
 * by calling them (`server/test/intent-sources.test.ts`).
 */

/** Row → the transport shape. Row types stop at the repository (onion §8). */
export function toIntentDto(row: PrIntentRow): PrIntentRecord {
  return {
    pr_id: row.prId,
    summary: row.summary,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    confidence: row.confidence,
    sources: row.sources,
    missing_context: row.missingContext,
    head_sha: row.headSha,
    provider: row.provider,
    model: row.model,
    derived_at: row.derivedAt.toISOString(),
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    // null = UNKNOWN, 0 = free. Never coalesced.
    cost_usd: row.costUsd,
  };
}

/**
 * Apply our caps to what the model claimed.
 *
 * Done HERE and not in the Zod schema: a model one item over the ceiling has
 * given a good answer that is one over our preference, and rejecting it at the
 * schema re-prompts and gets a much worse one back — 20 candidates became 4 at
 * double the output tokens when the conventions extractor tried that.
 *
 * The character cap doubles as an injection mitigation: laundered instruction
 * text does not fit in 80 characters as comfortably as a scope bullet does.
 */
export function capScopeItems(items: string[]): string[] {
  return items
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, MAX_SCOPE_ITEMS)
    .map((item) => (item.length > MAX_SCOPE_ITEM_CHARS ? item.slice(0, MAX_SCOPE_ITEM_CHARS) : item));
}

/**
 * Did anything beyond the PR title actually reach the model?
 *
 * The title alone is a headline. A scope derived from a headline is a guess, and
 * a guess must never be allowed to silence a finding — so this is the first of
 * the three conditions that arm the scope filter.
 */
export function hasSubstantiveSource(sources: IntentSource[]): boolean {
  return sources.some(
    (s) =>
      s.status === 'used' &&
      (s.kind === 'pr_body' || s.kind === 'linked_issue' || s.kind === 'repo_file'),
  );
}

/**
 * A gap that actually undermines the derivation: something the collector SET
 * OUT to read and could not.
 *
 * Only `linked_issue` and `repo_file` qualify. An unfetched `link` does not —
 * we never intended to fetch it, its absence is recorded for transparency, and
 * treating it as a gap conflates "there is a URL in the prose" with "the
 * classifier is working blind".
 *
 * This distinction exists because the original rule — *any* `missing_context`
 * entry disarms — made the scope filter DEAD CODE. Measured on three real PRs
 * of this repo: every one disarmed, and on two of them the only gaps were
 * unfetched links. One was `https://claude.com/claude-code`, the footer every
 * Claude Code-authored PR carries — so the feature could essentially never run.
 * A safety bound that is always on is not a safety bound, it is an off switch.
 *
 * KNOWN RESIDUAL RISK, accepted deliberately: a spec that lives on an external
 * wiki is a real intent source, and after this change its absence no longer
 * disarms the filter. We cannot tell that link from a marketing footer without
 * fetching it, and fetching is out of scope (SSRF). The other bounds still
 * hold — a substantive source is still required, a CRITICAL finding always
 * survives, `secret_leak`/`lethal_trifecta` are never droppable, and every drop
 * is logged — so the exposure is bounded to non-critical findings on a PR whose
 * scope was stated somewhere we were never able to look.
 */
export function hasMaterialGap(sources: IntentSource[]): boolean {
  return sources.some(
    (s) =>
      s.status === 'unavailable' && (s.kind === 'linked_issue' || s.kind === 'repo_file'),
  );
}

/**
 * The server's confidence FLOOR — it can only ever lower what the model said.
 *
 * A model claiming `high` off a bare title is not evidence of anything; a model
 * claiming `low` on rich inputs might be, so that direction is left alone.
 *
 * Keyed on a MATERIAL gap, not on any `missing_context` line, for the same
 * reason `scopeFilterArmed` is: a PR body that happens to contain a URL has not
 * thereby become harder to understand.
 */
export function applyConfidenceFloor(
  claimed: IntentConfidence,
  sources: IntentSource[],
): IntentConfidence {
  if (!hasSubstantiveSource(sources)) return 'low';
  if (hasMaterialGap(sources) && claimed === 'high') return 'medium';
  return claimed;
}

/**
 * May the engine's scope filter drop out-of-scope findings on this review?
 *
 * THREE conditions, all required, and the asymmetry is deliberate: a thin or
 * gap-ridden derivation DISARMS the filter, but no amount of model confidence
 * can arm one that the sources did not earn. `confidence` here is the
 * already-floored value, so "the model said high" cannot survive thin sources.
 *
 * Everything this gate protects against is on the drop side. Leaving the filter
 * off costs noise; turning it on wrongly costs a suppressed defect.
 *
 * The middle condition reads `hasMaterialGap`, NOT `missing_context.length`.
 * `missing_context` is a transparency record for the card and stays exactly as
 * it was — it is simply not the right input to a suppression decision. See
 * `hasMaterialGap` for the measurement that forced the change.
 */
export function scopeFilterArmed(record: PrIntentRecord): boolean {
  return (
    hasSubstantiveSource(record.sources) &&
    !hasMaterialGap(record.sources) &&
    record.confidence !== 'low'
  );
}

/**
 * Render the intent for the REVIEWER's prompt slot.
 *
 * Summary, both scope lists, and the source REFS — never the fetched content of
 * any source. The issue body, the plan file and the diff are all already gone by
 * this point; what is left is a claim and a provenance line, which is also
 * exactly what lands in `run_traces.trace.prompt_assembly.intent`.
 */
export function renderIntentBlock(record: PrIntentRecord): string {
  const lines = [`Stated purpose: ${record.summary}`];
  if (record.in_scope.length > 0) {
    lines.push('', 'In scope:', ...record.in_scope.map((i) => `- ${i}`));
  }
  if (record.out_of_scope.length > 0) {
    lines.push('', 'Explicitly out of scope:', ...record.out_of_scope.map((i) => `- ${i}`));
  }
  const used = record.sources.filter((s) => s.status === 'used').map((s) => `${s.kind}:${s.ref}`);
  lines.push('', `Derived with confidence=${record.confidence} from: ${used.join(', ') || 'nothing'}`);
  if (record.missing_context.length > 0) {
    lines.push(`Not available when this was derived: ${record.missing_context.join('; ')}`);
  }
  return lines.join('\n');
}

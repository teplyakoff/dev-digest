import type { ReviewFocusItem, Risk } from '@devdigest/shared';
import type { CollectedInput } from './sources.js';

/**
 * Grounding for the brief — the mirror of `groundFindings`
 * (`reviewer-core/src/grounding.ts`), one product surface over.
 *
 * THE RULE IS MEMBERSHIP OF A LIST, NOT TEXT MATCHING. A risk survives because
 * the thing it cites is in the input the model was shown; it does not survive
 * because it sounds specific. An element that fails is DROPPED, never softened —
 * the whole reason this product's findings are worth reading is that an
 * ungrounded one does not reach the reader at all.
 *
 * GROUNDING IS NOT INJECTION DEFENCE. A file maliciously named to look alarming
 * is in the allowlist if the PR really touched it, and it will pass. The defence
 * against text aimed at the model is the guard in `pipeline/prompt.ts`; these
 * two solve different problems and neither covers the other.
 *
 * TWO LISTS, NOT ONE, and the difference is the point (see `buildAllowlists`).
 */

/** One dropped element and why — the same shape `groundFindings` returns. */
export interface DroppedItem {
  /** `risk` or `focus`, for a log line that says what was lost. */
  kind: 'risk' | 'focus';
  title: string;
  reason: string;
}

export interface GroundedBrief {
  risks: Risk[];
  reviewFocus: ReviewFocusItem[];
  dropped: DroppedItem[];
  /** N of `N/M`: risks that survived. */
  keptRisks: number;
  /** M of `N/M`: risks the model returned, whatever the drop reason. */
  totalRisks: number;
  /**
   * False when the model returned risks and NONE survived (AC-58).
   *
   * Not the same as "there are no risks": `totalRisks === 0` means the model
   * found nothing, and this stays true. The distinction is what lets the card
   * say "we could not confirm these" rather than "this PR is safe".
   */
  risksGrounded: boolean;
}

/**
 * The two allowlists a brief is checked against.
 *
 * `refs` — changed files + symbol files + caller files + ENDPOINT ROUTES. Risks
 *   are checked against this one (AC-7, AC-9): a risk about `GET /repos/:id` is
 *   a legitimate risk, and a route is a thing the model was shown.
 *
 * `paths` — the same list WITHOUT the routes. `review_focus[].path` is checked
 *   against this one (AC-10), and the narrower list is deliberate: a focus item
 *   whose `path` is really a route (`GET /repos/:id`) would pass the wider check
 *   and hand the client an item with nothing to open — the client's own AC-42
 *   turns each item into a link into the diff. Checking against a SUBSET is
 *   stricter than AC-10 requires and satisfies it literally; it is called out
 *   here because it is an interpretation.
 *
 * On `degraded` both lists are built from the changed files alone (AC-8) — the
 * index answered nothing, so the diff is all the ground there is.
 */
export function buildAllowlists(input: CollectedInput): { refs: Set<string>; paths: Set<string> } {
  const paths = new Set<string>(input.blast.changed_files);
  // `changed_files` comes off the blast response; on a degraded map it is still
  // populated from `pr_files`, so this covers AC-8 without a second branch.
  for (const f of input.fileStats) paths.add(f.path);

  if (input.blast.status !== 'degraded') {
    for (const s of input.blast.symbols) {
      paths.add(s.file);
      for (const c of s.callers) paths.add(c.file);
    }
  }

  const refs = new Set(paths);
  if (input.blast.status !== 'degraded') {
    for (const e of input.blast.endpoints) refs.add(e.route);
  }

  return { refs, paths };
}

/**
 * Drop what the input does not support.
 *
 * TWO PREDICATES, TWO REASONS, ONE CONSEQUENCE:
 *   - `file_refs` is empty — the risk cites nothing (AC-68);
 *   - it cites something outside the allowlist (AC-9).
 * Both end the same way, and both count toward the SAME `M`. There is
 * deliberately no second metric: `N/M` exists to tell "the model found no risks"
 * (`M = 0`) from "we dropped everything it found" (`M = 5, N = 0`), and a
 * separate counter would make that headline ambiguous exactly where it is the
 * only thing that means something. The DISTINCTION lives in the journal, per
 * dropped item, in the same words as the predicates above.
 */
export function groundBrief(
  input: CollectedInput,
  extraction: { risks: Risk[]; review_focus: ReviewFocusItem[] },
): GroundedBrief {
  const { refs, paths } = buildAllowlists(input);
  const dropped: DroppedItem[] = [];

  const risks = extraction.risks.filter((risk) => {
    if (risk.file_refs.length === 0) {
      dropped.push({ kind: 'risk', title: risk.title, reason: 'no refs' });
      return false;
    }
    const stray = risk.file_refs.find((ref) => !refs.has(ref));
    if (stray !== undefined) {
      dropped.push({ kind: 'risk', title: risk.title, reason: `ref outside allowlist: ${stray}` });
      return false;
    }
    return true;
  });

  const reviewFocus = extraction.review_focus.filter((item) => {
    if (paths.has(item.path)) return true;
    dropped.push({
      kind: 'focus',
      title: item.path,
      reason: `path outside allowlist: ${item.path}`,
    });
    return false;
  });

  return {
    risks,
    reviewFocus,
    dropped,
    keptRisks: risks.length,
    totalRisks: extraction.risks.length,
    // `false` only when there WERE risks and none survived. A model that found
    // nothing has not failed grounding.
    risksGrounded: extraction.risks.length === 0 || risks.length > 0,
  };
}

/**
 * The unconditional line: `N/M`, whether or not anything was dropped (AC-11,
 * NFR-5).
 *
 * UNCONDITIONAL IS THE REQUIREMENT, not a nicety. A gate that reports only when
 * it acts is indistinguishable from a gate that never ran — the intent scope
 * filter shipped that way and a missing line could mean either "nothing was out
 * of scope" or "the rule silently said no" (`server/INSIGHTS.md`, 2026-08-06).
 * `groundFindings` had it right from the start, and this is the same sentence.
 */
export function groundingSummary(result: GroundedBrief): string {
  return `${result.keptRisks}/${result.totalRisks} passed`;
}

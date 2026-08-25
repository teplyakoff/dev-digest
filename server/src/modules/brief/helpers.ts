import type { PrBriefRecord } from '@devdigest/shared';
import type { PrBriefRow } from './repository.js';

/**
 * Row → contract. The one place a `pr_brief` row shape stops travelling (§5).
 *
 * `derived_at` becomes an ISO string here because a `Date` is not on the wire
 * and JSON serialisation of one is not the contract's business. `cost_usd` and
 * the token counts pass through UNTOUCHED: `null` means unknown and `0` means
 * free, and coalescing them is how "we could not price this" starts rendering as
 * "$0.00".
 */
export function toBriefDto(row: PrBriefRow): PrBriefRecord {
  return {
    pr_id: row.prId,
    what: row.what,
    why: row.why,
    risk_level: row.riskLevel,
    risks: row.risks,
    review_focus: row.reviewFocus,
    risks_grounded: row.risksGrounded,
    dropped_blocks: row.droppedBlocks,
    unavailable_inputs: row.unavailableInputs,
    head_sha: row.headSha,
    provider: row.provider,
    model: row.model,
    derived_at: row.derivedAt.toISOString(),
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    // null = UNKNOWN, 0 = free. Never coalesced.
    cost_usd: row.costUsd,
    attempts: row.attempts,
  };
}

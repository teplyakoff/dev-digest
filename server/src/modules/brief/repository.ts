import { eq } from 'drizzle-orm';
import type { Db, DbTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { BriefRiskLevel, ReviewFocusItem, Risk } from '@devdigest/shared';

/**
 * Brief data-access. Owns `pr_brief`, and nothing else does.
 *
 * The whole file is `modules/intent/repository.ts` with a different table, on
 * purpose: the two rows have the same lifecycle (one per PR, replaced on every
 * derivation, keyed on nothing but the PR).
 *
 * TENANCY. `pr_brief` carries no `workspace_id` and cannot be scoped here. The
 * SERVICE resolves the PR through `reviewRepo.getPull(workspaceId, prId)` first
 * and only then calls in; a caller that passes a `prId` straight from a request
 * has made a cross-tenant read. That is why the service, not the route, owns
 * this object.
 *
 * Writes take `tx?: DbTx` and resolve `tx ?? this.db` — the SERVICE decides what
 * is atomic. Never open a transaction in here.
 *
 * The `json` column is untouched by every method below. It is the starter's
 * original single-blob slot and stays an extension point.
 */

export type PrBriefRow = typeof t.prBrief.$inferSelect;

export interface UpsertBrief {
  prId: string;
  what: string;
  why: string;
  riskLevel: BriefRiskLevel;
  risks: Risk[];
  reviewFocus: ReviewFocusItem[];
  risksGrounded: boolean;
  droppedBlocks: string[];
  unavailableInputs: string[];
  headSha: string;
  provider: string;
  model: string;
  /** null = UNKNOWN. Never write 0 to mean "we don't know". */
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  attempts: number;
}

export class BriefRepository {
  constructor(private db: Db) {}

  async get(prId: string): Promise<PrBriefRow | undefined> {
    const [row] = await this.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    return row;
  }

  /**
   * Insert-or-replace one PR's brief. Every provenance column is overwritten,
   * `derived_at` included — a rebuild is a NEW answer, not an edit to the old
   * one, and a row whose `head_sha` moved while `derived_at` stayed put would
   * make staleness unreadable.
   */
  async upsert(values: UpsertBrief, tx?: DbTx): Promise<PrBriefRow> {
    const invoker = tx ?? this.db;
    const row = {
      prId: values.prId,
      what: values.what,
      why: values.why,
      riskLevel: values.riskLevel,
      risks: values.risks,
      reviewFocus: values.reviewFocus,
      risksGrounded: values.risksGrounded,
      droppedBlocks: values.droppedBlocks,
      unavailableInputs: values.unavailableInputs,
      headSha: values.headSha,
      provider: values.provider,
      model: values.model,
      derivedAt: new Date(),
      tokensIn: values.tokensIn,
      tokensOut: values.tokensOut,
      costUsd: values.costUsd,
      attempts: values.attempts,
    };
    const [inserted] = await invoker
      .insert(t.prBrief)
      .values(row)
      .onConflictDoUpdate({
        target: t.prBrief.prId,
        set: {
          what: row.what,
          why: row.why,
          riskLevel: row.riskLevel,
          risks: row.risks,
          reviewFocus: row.reviewFocus,
          risksGrounded: row.risksGrounded,
          droppedBlocks: row.droppedBlocks,
          unavailableInputs: row.unavailableInputs,
          headSha: row.headSha,
          provider: row.provider,
          model: row.model,
          derivedAt: row.derivedAt,
          tokensIn: row.tokensIn,
          tokensOut: row.tokensOut,
          costUsd: row.costUsd,
          attempts: row.attempts,
        },
      })
      .returning();
    return inserted!;
  }
}

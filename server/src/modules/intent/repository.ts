import { eq } from 'drizzle-orm';
import type { Db, DbTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { IntentConfidence, IntentSource } from '@devdigest/shared';

/**
 * Intent data-access. Owns `pr_intent`, and nothing else does.
 *
 * `upsertIntent` / `getIntent` used to live in `modules/reviews/repository/
 * pull.repo.ts`. They moved here in L03: two modules must not own one table, and
 * the move was free because the pair had never had a caller. Other modules reach
 * this through `container.intent` (onion §11) — never by importing this file.
 *
 * TENANCY. `pr_intent` carries no `workspace_id` (nor did it before L03), so
 * NOTHING here is workspace-scoped and nothing here can be. The service resolves
 * the PR through `reviewRepo.getPull(workspaceId, prId)` first and only then
 * calls in. A caller that passes a `prId` straight from a request has created a
 * cross-tenant read; that is why the service, not the route, owns this.
 *
 * Writes take `tx?: DbTx` and resolve `tx ?? this.db` — the SERVICE decides what
 * is atomic. Never open a transaction in here.
 */

export type PrIntentRow = typeof t.prIntent.$inferSelect;

export interface UpsertIntent {
  prId: string;
  summary: string;
  inScope: string[];
  outOfScope: string[];
  confidence: IntentConfidence;
  sources: IntentSource[];
  missingContext: string[];
  headSha: string;
  provider: string;
  model: string;
  /** null = UNKNOWN. Never write 0 to mean "we don't know". */
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
}

export class IntentRepository {
  constructor(private db: Db) {}

  async get(prId: string): Promise<PrIntentRow | undefined> {
    const [row] = await this.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
    return row;
  }

  /**
   * Insert-or-replace one PR's intent. Every provenance column is overwritten,
   * `derived_at` included — a re-derivation is a NEW answer, not an edit to the
   * old one, and a row whose `head_sha` moved while `derived_at` stayed put
   * would make staleness unreadable.
   */
  async upsert(values: UpsertIntent, tx?: DbTx): Promise<PrIntentRow> {
    const invoker = tx ?? this.db;
    const row = {
      prId: values.prId,
      summary: values.summary,
      inScope: values.inScope,
      outOfScope: values.outOfScope,
      confidence: values.confidence,
      sources: values.sources,
      missingContext: values.missingContext,
      headSha: values.headSha,
      provider: values.provider,
      model: values.model,
      derivedAt: new Date(),
      tokensIn: values.tokensIn,
      tokensOut: values.tokensOut,
      costUsd: values.costUsd,
    };
    const [inserted] = await invoker
      .insert(t.prIntent)
      .values(row)
      .onConflictDoUpdate({
        target: t.prIntent.prId,
        set: {
          summary: row.summary,
          inScope: row.inScope,
          outOfScope: row.outOfScope,
          confidence: row.confidence,
          sources: row.sources,
          missingContext: row.missingContext,
          headSha: row.headSha,
          provider: row.provider,
          model: row.model,
          derivedAt: row.derivedAt,
          tokensIn: row.tokensIn,
          tokensOut: row.tokensOut,
          costUsd: row.costUsd,
        },
      })
      .returning();
    return inserted!;
  }
}

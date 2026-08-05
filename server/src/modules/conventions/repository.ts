import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db, DbTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionCategory, ConventionStatus } from '@devdigest/shared';

/**
 * Conventions data-access. Owns `conventions` and `convention_scans`, and reads
 * `repos` for the clone path and full name a scan needs.
 *
 * Write methods take `tx?: DbTx` and never open a transaction of their own — the
 * service decides what is atomic (db/client.ts).
 */

export type ConventionRow = typeof t.conventions.$inferSelect;
export type ConventionScanRow = typeof t.conventionScans.$inferSelect;

/** What a scan needs to know about the repo it is scanning. */
export interface RepoBasics {
  id: string;
  fullName: string;
  clonePath: string | null;
}

export interface InsertScan {
  workspaceId: string;
  repoId: string;
  indexedSha: string;
  sampledFiles: string[];
  configFiles: string[];
  proposed: number;
  kept: number;
  dropped: { rule: string; reason: string }[];
  provider: string;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
}

export interface InsertCandidate {
  workspaceId: string;
  repoId: string;
  scanId: string;
  category: ConventionCategory;
  rule: string;
  evidencePath: string;
  evidenceStartLine: number;
  evidenceEndLine: number;
  evidenceSnippet: string;
  confidence: number;
  status: ConventionStatus;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  /** Workspace-scoped, so a repo id from another tenant simply does not resolve. */
  async getRepoBasics(workspaceId: string, repoId: string): Promise<RepoBasics | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, fullName: t.repos.fullName, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /** The repo's most recent scan, or undefined before the first one. */
  async latestScan(workspaceId: string, repoId: string): Promise<ConventionScanRow | undefined> {
    const rows = await this.db
      .select()
      .from(t.conventionScans)
      .where(
        and(eq(t.conventionScans.workspaceId, workspaceId), eq(t.conventionScans.repoId, repoId)),
      )
      .orderBy(asc(t.conventionScans.createdAt));
    return rows[rows.length - 1];
  }

  /**
   * Candidates for a repo. Ordered by category then rule so the page's grouping
   * is stable across reloads — confidence order would reshuffle the list every
   * time a re-scan moved a number by 0.01.
   */
  async listCandidates(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(asc(t.conventions.category), asc(t.conventions.rule));
  }

  async getCandidate(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  async listAccepted(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.status, 'accepted'),
        ),
      )
      .orderBy(asc(t.conventions.category), asc(t.conventions.rule));
  }

  async insertScan(values: InsertScan, tx?: DbTx): Promise<ConventionScanRow> {
    const invoker = tx ?? this.db;
    const [row] = await invoker.insert(t.conventionScans).values(values).returning();
    return row!;
  }

  /** Clear a repo's candidates. The scan rows stay — they are the audit trail. */
  async deleteCandidatesForRepo(workspaceId: string, repoId: string, tx?: DbTx): Promise<void> {
    const invoker = tx ?? this.db;
    await invoker
      .delete(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)));
  }

  async insertCandidates(values: InsertCandidate[], tx?: DbTx): Promise<ConventionRow[]> {
    if (values.length === 0) return [];
    const invoker = tx ?? this.db;
    return invoker.insert(t.conventions).values(values).returning();
  }

  async updateCandidate(
    workspaceId: string,
    id: string,
    patch: { status?: ConventionStatus; rule?: string; category?: ConventionCategory },
    tx?: DbTx,
  ): Promise<ConventionRow | undefined> {
    const invoker = tx ?? this.db;
    const [row] = await invoker
      .update(t.conventions)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  /** Stamp the skill a set of candidates was merged into. */
  async setSkillId(
    workspaceId: string,
    ids: string[],
    skillId: string,
    tx?: DbTx,
  ): Promise<void> {
    if (ids.length === 0) return;
    const invoker = tx ?? this.db;
    await invoker
      .update(t.conventions)
      .set({ skillId })
      .where(and(eq(t.conventions.workspaceId, workspaceId), inArray(t.conventions.id, ids)));
  }
}

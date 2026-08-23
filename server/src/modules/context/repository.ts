import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, DbTx } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Project-context data access. Owns `context_docs`, `agent_context_docs` and
 * `skill_context_docs`, and reads `repos`, `agents` and `skills` for the
 * workspace checks that make a cross-tenant id fail to resolve.
 *
 * **`workspaceId` is a required first parameter on every method, without
 * exception.** Not a convenience: `agent_context_docs` and `skill_context_docs`
 * have no workspace column of their own — the tenant is reachable only by
 * joining the agent, the skill or the document — so a method that made the
 * parameter optional would be one careless call site away from serving another
 * workspace's documents, and nothing about the code would look wrong.
 *
 * Write methods take `tx?: DbTx` and never open a transaction of their own; the
 * service decides what is atomic (db/client.ts).
 */

export type ContextDocRow = typeof t.contextDocs.$inferSelect;

/** A document without its body — what a list row and an attachment need. */
export interface DocMeta {
  id: string;
  name: string;
  body: string;
  updatedAt: Date;
}

export class ContextRepository {
  constructor(private db: Db) {}

  // ---- documents ----------------------------------------------------------

  /**
   * Every document in a repo's store, alphabetically by name.
   *
   * The order is the same one the prompt uses, so what a person sees on the page
   * and what a run assembles cannot disagree about sequence.
   */
  async listDocs(workspaceId: string, repoId: string): Promise<ContextDocRow[]> {
    return this.db
      .select()
      .from(t.contextDocs)
      .where(and(eq(t.contextDocs.workspaceId, workspaceId), eq(t.contextDocs.repoId, repoId)))
      .orderBy(asc(t.contextDocs.name));
  }

  /** One document with its body, or `undefined` — including for another tenant's id. */
  async getDoc(workspaceId: string, docId: string): Promise<ContextDocRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.contextDocs)
      .where(and(eq(t.contextDocs.workspaceId, workspaceId), eq(t.contextDocs.id, docId)));
    return row;
  }

  /** Documents by id, in one query, scoped to the tenant. Order is not promised. */
  async docsByIds(workspaceId: string, docIds: string[]): Promise<ContextDocRow[]> {
    if (docIds.length === 0) return [];
    return this.db
      .select()
      .from(t.contextDocs)
      .where(and(eq(t.contextDocs.workspaceId, workspaceId), inArray(t.contextDocs.id, docIds)));
  }

  async createDoc(
    workspaceId: string,
    repoId: string,
    name: string,
    body: string,
    tx?: DbTx,
  ): Promise<ContextDocRow> {
    const [row] = await (tx ?? this.db)
      .insert(t.contextDocs)
      .values({ workspaceId, repoId, name, body })
      .returning();
    return row!;
  }

  /**
   * Replace a document's body. Last write wins — there is no version column and
   * no conflict detection, which is what AC-40 asks for and what the plan's
   * *Open decisions* records as a deliberate, and lossy, choice.
   */
  async replaceBody(
    workspaceId: string,
    docId: string,
    body: string,
    tx?: DbTx,
  ): Promise<ContextDocRow | undefined> {
    const [row] = await (tx ?? this.db)
      .update(t.contextDocs)
      .set({ body, updatedAt: new Date() })
      .where(and(eq(t.contextDocs.workspaceId, workspaceId), eq(t.contextDocs.id, docId)))
      .returning();
    return row;
  }

  async deleteDoc(workspaceId: string, docId: string, tx?: DbTx): Promise<boolean> {
    const rows = await (tx ?? this.db)
      .delete(t.contextDocs)
      .where(and(eq(t.contextDocs.workspaceId, workspaceId), eq(t.contextDocs.id, docId)))
      .returning({ id: t.contextDocs.id });
    return rows.length > 0;
  }

  /**
   * Total UTF-8 bytes stored for a repo — the number `MAX_STORE_BYTES` is checked
   * against, summed in SQL rather than by loading every body to add up lengths.
   *
   * `octet_length`, not `length`: `length` counts CHARACTERS, so a store bound
   * built on it would let a document of Cyrillic or CJK text occupy two to four
   * times the bytes it claims. The bound is about storage, so it counts bytes.
   *
   * `sum()` comes back as a **string** from postgres-js (it is a bigint), and an
   * aggregate over no rows still returns one row — with a NULL sum. Both are why
   * this is `Number(row?.total ?? 0)` and not `rows[0].total`.
   */
  async storeBytes(workspaceId: string, repoId: string): Promise<number> {
    // postgres-js hands `execute` the rows themselves — there is no `.rows`
    // wrapper here, unlike node-postgres. `.rows[0]` would typecheck, compile,
    // and read `undefined` at runtime.
    const rows = (await this.db.execute(sql`
      SELECT coalesce(sum(octet_length(body)), 0) AS total
      FROM ${t.contextDocs}
      WHERE workspace_id = ${workspaceId} AND repo_id = ${repoId}
    `)) as unknown as Array<{ total: string | number }>;
    return Number(rows[0]?.total ?? 0);
  }

  // ---- tenancy checks -----------------------------------------------------

  /**
   * Does this repo belong to this workspace? Returns its clone path, which the
   * import picker needs and which is `null` until the repo has been cloned.
   */
  async getRepo(
    workspaceId: string,
    repoId: string,
  ): Promise<{ id: string; clonePath: string | null } | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /** `true` only when the agent exists AND belongs to this workspace. */
  async agentExists(workspaceId: string, agentId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)));
    return row !== undefined;
  }

  /** `true` only when the skill exists AND belongs to this workspace. */
  async skillExists(workspaceId: string, skillId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, skillId)));
    return row !== undefined;
  }

  // ---- attachments --------------------------------------------------------

  /**
   * Replace an agent's whole attachment set.
   *
   * Delete-then-insert inside one transaction, because the contract is REPLACE:
   * the caller sends every id it wants attached, and the ids it left out are
   * detached by their absence. A diff would be the same result with more code
   * and one more way to be wrong.
   *
   * The ids are filtered to documents in THIS workspace before the insert, so a
   * borrowed uuid attaches nothing rather than reaching across the tenant line.
   */
  async setAgentDocs(workspaceId: string, agentId: string, docIds: string[]): Promise<void> {
    const owned = await this.ownedIds(workspaceId, docIds);
    await this.db.transaction(async (tx) => {
      await tx.delete(t.agentContextDocs).where(eq(t.agentContextDocs.agentId, agentId));
      if (owned.length > 0) {
        await tx.insert(t.agentContextDocs).values(owned.map((docId) => ({ agentId, docId })));
      }
    });
  }

  /** Replace a skill's whole attachment set. Same contract as `setAgentDocs`. */
  async setSkillDocs(workspaceId: string, skillId: string, docIds: string[]): Promise<void> {
    const owned = await this.ownedIds(workspaceId, docIds);
    await this.db.transaction(async (tx) => {
      await tx.delete(t.skillContextDocs).where(eq(t.skillContextDocs.skillId, skillId));
      if (owned.length > 0) {
        await tx.insert(t.skillContextDocs).values(owned.map((docId) => ({ skillId, docId })));
      }
    });
  }

  /**
   * The doc ids currently attached to an agent.
   *
   * `workspaceId` is required and the query filters on it, like every other
   * method here. `agent_context_docs` has no workspace column, so the join onto
   * `context_docs` IS the tenant line — without it the method would return
   * whatever the row said and rely on the caller having checked first. Callers do
   * check today; the point is that the guarantee should not depend on their
   * remembering to.
   */
  async agentDocIds(workspaceId: string, agentId: string): Promise<string[]> {
    const rows = await this.db
      .select({ docId: t.agentContextDocs.docId })
      .from(t.agentContextDocs)
      .innerJoin(t.contextDocs, eq(t.agentContextDocs.docId, t.contextDocs.id))
      .where(
        and(
          eq(t.agentContextDocs.agentId, agentId),
          eq(t.contextDocs.workspaceId, workspaceId),
        ),
      );
    return rows.map((r) => r.docId);
  }

  /** The doc ids currently attached to a skill. Same tenant rule as the agent side. */
  async skillDocIds(workspaceId: string, skillId: string): Promise<string[]> {
    const rows = await this.db
      .select({ docId: t.skillContextDocs.docId })
      .from(t.skillContextDocs)
      .innerJoin(t.contextDocs, eq(t.skillContextDocs.docId, t.contextDocs.id))
      .where(
        and(
          eq(t.skillContextDocs.skillId, skillId),
          eq(t.contextDocs.workspaceId, workspaceId),
        ),
      );
    return rows.map((r) => r.docId);
  }

  /**
   * The documents an agent carries for one repo, with their bodies.
   *
   * Filtered by `repoId` as well as by the attachment: a store is per-repository,
   * so an agent reviewing repo B must not be handed the documents it was given
   * for repo A. An attachment row that no longer resolves — the document was
   * deleted — simply produces no row here, which is what lets a run skip it and
   * complete rather than fail.
   */
  async docsForAgent(workspaceId: string, agentId: string, repoId: string): Promise<DocMeta[]> {
    const rows = await this.db
      .select({
        id: t.contextDocs.id,
        name: t.contextDocs.name,
        body: t.contextDocs.body,
        updatedAt: t.contextDocs.updatedAt,
      })
      .from(t.agentContextDocs)
      .innerJoin(t.contextDocs, eq(t.agentContextDocs.docId, t.contextDocs.id))
      .where(
        and(
          eq(t.agentContextDocs.agentId, agentId),
          eq(t.contextDocs.workspaceId, workspaceId),
          eq(t.contextDocs.repoId, repoId),
        ),
      );
    return rows;
  }

  /** The same, for a set of skills. Empty in, empty out — no query is issued. */
  async docsForSkills(
    workspaceId: string,
    skillIds: string[],
    repoId: string,
  ): Promise<DocMeta[]> {
    if (skillIds.length === 0) return [];
    const rows = await this.db
      .select({
        id: t.contextDocs.id,
        name: t.contextDocs.name,
        body: t.contextDocs.body,
        updatedAt: t.contextDocs.updatedAt,
      })
      .from(t.skillContextDocs)
      .innerJoin(t.contextDocs, eq(t.skillContextDocs.docId, t.contextDocs.id))
      .where(
        and(
          inArray(t.skillContextDocs.skillId, skillIds),
          eq(t.contextDocs.workspaceId, workspaceId),
          eq(t.contextDocs.repoId, repoId),
        ),
      );
    return rows;
  }

  /** Of `docIds`, the ones that really are this workspace's. */
  private async ownedIds(workspaceId: string, docIds: string[]): Promise<string[]> {
    const unique = [...new Set(docIds)];
    if (unique.length === 0) return [];
    const rows = await this.db
      .select({ id: t.contextDocs.id })
      .from(t.contextDocs)
      .where(and(eq(t.contextDocs.workspaceId, workspaceId), inArray(t.contextDocs.id, unique)));
    return rows.map((r) => r.id);
  }
}

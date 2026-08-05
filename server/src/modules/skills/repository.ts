import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, DbTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillSource, SkillType } from '@devdigest/shared';
import { INITIAL_SKILL_VERSION } from './constants.js';

/**
 * A1 — skills data-access. Owns `skills` and `skill_versions`. The
 * `agent_skills` link table is shared with A2, which owns the agent side
 * (link/reorder/list for one agent); this repository only reads across it to
 * answer "which agents use this skill". Workspace-scoped throughout.
 *
 * Write methods take `tx?: DbTx` and never open a transaction of their own — the
 * service decides what is atomic (db/client.ts).
 */

import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
export type { SkillRow, SkillVersionRow };

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
  evidenceFiles?: string[] | null;
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  /** Resolved by the service from `isBodyChange`; the repository just writes it. */
  version?: number;
}

/** An agent that links this skill (joined from agent_skills). */
export interface SkillUsageRow {
  agentId: string;
  agentName: string;
}

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId))
      .orderBy(asc(t.skills.name));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  /** Delete a skill. `agent_skills` and `skill_versions` cascade. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  async insert(values: InsertSkill, tx?: DbTx): Promise<SkillRow> {
    const invoker = tx ?? this.db;
    const [row] = await invoker
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled ?? true,
        version: INITIAL_SKILL_VERSION,
        evidenceFiles: values.evidenceFiles ?? null,
      })
      .returning();
    return row!;
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
    tx?: DbTx,
  ): Promise<SkillRow | undefined> {
    const invoker = tx ?? this.db;
    const [row] = await invoker
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.version !== undefined ? { version: patch.version } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();
    return row;
  }

  // ---- skill_versions (immutable body snapshots) --------------------------

  /** Snapshot a body as `version`. Idempotent: re-snapshotting a version is a no-op. */
  async snapshotVersion(
    skillId: string,
    version: number,
    body: string,
    tx?: DbTx,
  ): Promise<void> {
    const invoker = tx ?? this.db;
    await invoker
      .insert(t.skillVersions)
      .values({ skillId, version, body })
      .onConflictDoNothing();
  }

  /** All snapshots for a skill, newest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /** A single snapshot, or undefined if that version was never recorded. */
  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  /**
   * How many agents link each of `skillIds`, as one grouped query — the list
   * endpoint's read-time aggregation (same shape as the PR list's score/cost
   * blocks). Skills with no agents are simply absent from the map; the caller
   * defaults them to 0.
   */
  async usageCounts(workspaceId: string, skillIds: string[]): Promise<Map<string, number>> {
    if (skillIds.length === 0) return new Map();
    const rows = await this.db
      .select({ skillId: t.agentSkills.skillId, n: count() })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(
        and(inArray(t.agentSkills.skillId, skillIds), eq(t.agents.workspaceId, workspaceId)),
      )
      .groupBy(t.agentSkills.skillId);
    return new Map(rows.map((r) => [r.skillId, Number(r.n)]));
  }

  // ---- usage (read-only join across agent_skills) -------------------------

  /**
   * What this skill cost across the runs that loaded it, read back out of the
   * persisted traces.
   *
   * Three things about the SQL are load-bearing:
   *
   * - The match is on skill NAME, because that is what `run-executor` writes
   *   into `trace.config.skills` — there is no id in the trace. Names are unique
   *   per workspace, so this cannot collide; a rename does orphan older runs,
   *   which the contract documents.
   * - The `jsonb_typeof(...) = 'array'` guard is not defensive noise. Traces
   *   persisted before L02 have no `skills` key at all, and one written as JSON
   *   `null` would make `jsonb_array_elements` raise "cannot extract elements
   *   from a scalar" — one bad row would fail the whole endpoint.
   * - `agent_runs.workspace_id` is the tenant boundary; `run_traces` has no
   *   workspace column of its own.
   */
  async traceStats(
    workspaceId: string,
    skillName: string,
  ): Promise<{ runs: number; tokensTotal: number; lastLoadedAt: Date | null }> {
    // postgres-js hands `execute` the rows themselves (a RowList, which IS an
    // array) — there is no `.rows` wrapper here, unlike node-postgres.
    const rows = (await this.db.execute(sql`
      SELECT count(*) AS runs,
             coalesce(sum((s->>'tokens')::bigint), 0) AS tokens_total,
             max(ar.ran_at) AS last_loaded_at
      FROM ${t.runTraces} rt
      JOIN ${t.agentRuns} ar ON ar.id = rt.run_id
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(rt.trace->'config'->'skills') = 'array'
             THEN rt.trace->'config'->'skills'
             ELSE '[]'::jsonb END
      ) AS s
      WHERE ar.workspace_id = ${workspaceId}
        AND s->>'name' = ${skillName}
    `)) as unknown as Array<{
      runs: string | number;
      tokens_total: string | number;
      last_loaded_at: Date | string | null;
    }>;
    // `count`/`sum` come back as strings (bigint), and an aggregate over no rows
    // still returns one row — with a null max — so this never needs a length check.
    const row = rows[0];
    const last = row?.last_loaded_at ?? null;
    return {
      runs: Number(row?.runs ?? 0),
      tokensTotal: Number(row?.tokens_total ?? 0),
      lastLoadedAt: last === null ? null : new Date(last),
    };
  }

  /**
   * Agents in this workspace that link the skill. Scoped on the AGENT's
   * workspace as well as the skill's: `agent_skills` has no workspace column of
   * its own, so without the join predicate a cross-tenant link row would leak
   * an agent name.
   */
  async usage(workspaceId: string, skillId: string): Promise<SkillUsageRow[]> {
    return this.db
      .select({ agentId: t.agents.id, agentName: t.agents.name })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(and(eq(t.agentSkills.skillId, skillId), eq(t.agents.workspaceId, workspaceId)))
      .orderBy(asc(t.agents.name));
  }
}

import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
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

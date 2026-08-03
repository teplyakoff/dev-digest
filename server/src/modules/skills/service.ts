import type { Container } from '../../platform/container.js';
import type {
  Skill,
  SkillImportPreview,
  SkillType,
  SkillUsage,
  SkillVersion,
} from '@devdigest/shared';
import { SkillsRepository } from './repository.js';
import { toSkillDto, toSkillVersionDto, isBodyChange, isDuplicateName } from './helpers.js';
import { INITIAL_SKILL_VERSION } from './constants.js';
import { parseSkillUpload } from './import/parse.js';
import { ConflictError } from '../../platform/errors.js';

/**
 * A1 — skills service. Business logic for the Skills page + skill editor.
 *
 * A Skill = a markdown body plus the metadata that makes it findable. The body
 * is the only thing that ever reaches a model; name/description/type/enabled are
 * how a person reasons about it. Body changes are versioned via `skill_versions`
 * so a past eval run stays reproducible against the exact text it scored.
 */

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  source?: Skill['source'];
  enabled?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

export class SkillsService {
  private repo: SkillsRepository;
  private db: Container['db'];

  constructor(container: Container) {
    this.db = container.db;
    this.repo = new SkillsRepository(container.db);
  }

  /**
   * The Skills grid. `used_by` is denormalized on read here — one grouped query
   * over `agent_skills` rather than a request per card — and is deliberately
   * absent from every other route, so "not loaded" and "zero agents" stay
   * distinguishable in the UI.
   */
  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    const counts = await this.repo.usageCounts(
      workspaceId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({ ...toSkillDto(r), used_by: counts.get(r.id) ?? 0 }));
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  /**
   * Create a skill and snapshot its body as v1 — one business fact, so one
   * transaction. A skill whose v1 snapshot is missing would make its own
   * version history start at v2 and read as if a revision had been deleted.
   */
  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    try {
      const row = await this.db.transaction(async (tx) => {
        const created = await this.repo.insert(
          {
            workspaceId,
            name: input.name,
            description: input.description,
            type: input.type,
            source: input.source ?? 'manual',
            body: input.body,
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          },
          tx,
        );
        await this.repo.snapshotVersion(created.id, INITIAL_SKILL_VERSION, created.body, tx);
        return created;
      });
      return toSkillDto(row);
    } catch (err) {
      // The unique index is the guard; this turns tripping it into an answer a
      // person can act on instead of a 500 carrying the constraint name.
      if (isDuplicateName(err)) {
        throw new ConflictError(`A skill named "${input.name}" already exists in this workspace.`);
      }
      throw err;
    }
  }

  /**
   * Update a skill. A body change bumps the version and snapshots the new text;
   * renaming, re-describing or toggling `enabled` does not (see `isBodyChange`).
   * The bump and the snapshot are one transaction — a bumped `version` with no
   * matching row in `skill_versions` is a version history with a hole in it.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const existing = await this.repo.getById(workspaceId, id);
    if (!existing) return undefined;

    const bodyChanged = isBodyChange(existing, patch);
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    try {
      const row = await this.db.transaction(async (tx) => {
        const updated = await this.repo.update(
          workspaceId,
          id,
          { ...patch, ...(bodyChanged ? { version: nextVersion } : {}) },
          tx,
        );
        if (bodyChanged && updated) {
          await this.repo.snapshotVersion(updated.id, nextVersion, updated.body, tx);
        }
        return updated;
      });
      return row ? toSkillDto(row) : undefined;
    } catch (err) {
      // Renaming onto a taken name trips the same index as create.
      if (isDuplicateName(err)) {
        throw new ConflictError(`A skill named "${patch.name}" already exists in this workspace.`);
      }
      throw err;
    }
  }

  /** Delete a skill. Its agent links and version snapshots cascade. */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /**
   * Body history, newest first. Workspace-scoped: returns undefined when the
   * skill isn't in this workspace (the route maps that to 404) so snapshots
   * can't be read across tenants.
   */
  async listVersions(workspaceId: string, skillId: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(skillId);
    return rows.map(toSkillVersionDto);
  }

  /** One body snapshot. Undefined when the skill is out of workspace OR that
   *  version was never recorded (route → 404 either way). */
  async getVersion(
    workspaceId: string,
    skillId: string,
    version: number,
  ): Promise<SkillVersion | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const row = await this.repo.getVersion(skillId, version);
    return row ? toSkillVersionDto(row) : undefined;
  }

  // ---- import (preview → confirm) -----------------------------------------

  /**
   * Parse an upload into a preview. Writes NOTHING — that is the whole point:
   * a person reads what the file actually contains, and what the importer
   * refused to open, before any of it can reach an agent's prompt.
   */
  preview(filename: string, content: Buffer): SkillImportPreview {
    return parseSkillUpload({ filename, content });
  }

  /**
   * Persist a previewed skill. It lands **disabled**: the body is someone
   * else's instructions until a person has read it and turned it on, and that
   * enable is the moment they adopt it.
   *
   * The preview is re-validated by the same Zod schema at the route, not
   * treated as a token — a client that edited the body between the two calls
   * gets the edited body, which is fine. The gate is that a human saw it, not
   * that the bytes are unchanged.
   */
  async importConfirm(workspaceId: string, preview: SkillImportPreview): Promise<Skill> {
    return this.create(workspaceId, {
      name: preview.name,
      description: preview.description,
      type: preview.type,
      body: preview.body,
      source: 'imported_file',
      enabled: false,
    });
  }

  /** Agents that load this skill — the card's "N agents" and the delete warning. */
  async usage(workspaceId: string, skillId: string): Promise<SkillUsage[] | undefined> {
    const skill = await this.repo.getById(workspaceId, skillId);
    if (!skill) return undefined;
    const rows = await this.repo.usage(workspaceId, skillId);
    return rows.map((r) => ({ agent_id: r.agentId, agent_name: r.agentName }));
  }
}

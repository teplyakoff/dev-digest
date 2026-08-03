import type { Skill, SkillSource, SkillType, SkillVersion } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';

/**
 * Pure helpers for the skills module — row ⇄ DTO mapping and the version-bump
 * rule. No I/O, so every one of these is testable without Docker.
 */

/** Map a persisted skill row to the public `Skill` DTO. */
export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

/** Map a `skill_versions` row to the public `SkillVersion` DTO. */
export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * True when a patch changes the skill's BODY relative to the existing row.
 *
 * Deliberately narrower than the agents module's `isConfigChange`: for an agent,
 * the model and the system prompt are both config, so both bump the version. For
 * a skill the body IS the artifact and everything else — name, description,
 * type, enabled — is metadata about it. Renaming a skill must not invalidate the
 * eval history of text that never changed.
 */
export function isBodyChange(existing: Pick<SkillRow, 'body'>, patch: { body?: string }): boolean {
  return patch.body !== undefined && patch.body !== existing.body;
}

/** Postgres `unique_violation`. */
const PG_UNIQUE_VIOLATION = '23505';

/** The per-workspace unique index on `skills(workspace_id, name)` (migration 0012). */
const SKILL_NAME_CONSTRAINT = 'skills_workspace_id_name_uq';

/**
 * Did this driver error come from a duplicate skill name?
 *
 * Matched structurally rather than with `instanceof`: the error travels up from
 * postgres-js, whose error class is not something a module should import (onion
 * §5 — library error classes do not travel inward).
 *
 * Why it is worth translating at all: creating a skill whose name is taken is a
 * routine user action, and re-importing the same file hits it every time because
 * `resolveName` derives the name deterministically from the filename. Left
 * untranslated it surfaces as a 500 carrying the raw constraint name to the
 * client.
 */
export function isDuplicateName(err: unknown): boolean {
  const e = err as { code?: string; constraint_name?: string; constraint?: string } | null;
  if (!e || e.code !== PG_UNIQUE_VIOLATION) return false;
  const constraint = e.constraint_name ?? e.constraint;
  // No constraint name (older driver shapes) → still a unique violation on a
  // table whose only unique index is this one.
  return constraint === undefined || constraint === SKILL_NAME_CONSTRAINT;
}

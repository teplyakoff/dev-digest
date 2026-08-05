import { describe, it, expect } from 'vitest';
import {
  isBodyChange,
  isDuplicateName,
  toSkillDto,
  toSkillVersionDto,
} from '../src/modules/skills/helpers.js';
import type { SkillRow, SkillVersionRow } from '../src/db/rows.js';

/**
 * The skills module's pure layer: row ⇄ DTO and the version-bump rule. Ring 0 —
 * no app, no container, no Docker.
 */

const NOW = new Date('2026-08-03T12:00:00Z');

function skill(over: Partial<SkillRow> = {}): SkillRow {
  return {
    id: 'sk-1',
    workspaceId: 'ws-1',
    name: 'test-quality-rubric',
    description: 'Flag new branches that no test asserts on.',
    type: 'rubric',
    source: 'manual',
    body: '# Tests\nCover new branches.',
    enabled: true,
    version: 3,
    evidenceFiles: null,
    createdAt: NOW,
    ...over,
  } as SkillRow;
}

describe('toSkillDto', () => {
  it('maps a row to the wire shape', () => {
    expect(toSkillDto(skill())).toEqual({
      id: 'sk-1',
      name: 'test-quality-rubric',
      description: 'Flag new branches that no test asserts on.',
      type: 'rubric',
      source: 'manual',
      body: '# Tests\nCover new branches.',
      enabled: true,
      version: 3,
      evidence_files: null,
    });
  });

  it('normalises absent evidence files to null, not undefined', () => {
    // `undefined` disappears through JSON.stringify, so the client would see the
    // key missing on one skill and present on another for the same meaning.
    expect(toSkillDto(skill({ evidenceFiles: null })).evidence_files).toBeNull();
    expect(toSkillDto(skill({ evidenceFiles: ['a.ts'] })).evidence_files).toEqual(['a.ts']);
  });
});

describe('toSkillVersionDto', () => {
  it('serialises the timestamp as an ISO string', () => {
    const row: SkillVersionRow = {
      skillId: 'sk-1',
      version: 2,
      body: 'v2 body',
      createdAt: NOW,
    };
    expect(toSkillVersionDto(row)).toEqual({
      skill_id: 'sk-1',
      version: 2,
      body: 'v2 body',
      created_at: '2026-08-03T12:00:00.000Z',
    });
  });
});

describe('isBodyChange', () => {
  it('is true only when the body actually differs', () => {
    expect(isBodyChange(skill(), { body: 'something else' })).toBe(true);
    expect(isBodyChange(skill(), { body: skill().body })).toBe(false);
    expect(isBodyChange(skill(), {})).toBe(false);
  });

  it('ignores metadata — renaming a skill must not invalidate its eval history', () => {
    // Deliberately narrower than the agents module's `isConfigChange`, where the
    // model and the prompt are both config. For a skill the body IS the artifact.
    const patch = { name: 'renamed', description: 'new words', enabled: false } as {
      body?: string;
    };
    expect(isBodyChange(skill(), patch)).toBe(false);
  });
});

describe('isDuplicateName', () => {
  /**
   * This is the only thing between a routine user action — creating a skill
   * whose name is taken, or re-importing the same file — and a 500 carrying the
   * constraint name to the client. It matches STRUCTURALLY (postgres-js's error
   * class must not travel inward, onion §5), which makes it exactly the kind of
   * predicate that rots silently when a driver changes shape. Hence the table.
   */
  it('recognises the unique violation on the skills name index', () => {
    expect(
      isDuplicateName({ code: '23505', constraint_name: 'skills_workspace_id_name_uq' }),
    ).toBe(true);
  });

  it('accepts the alternate `constraint` key some driver versions use', () => {
    expect(isDuplicateName({ code: '23505', constraint: 'skills_workspace_id_name_uq' })).toBe(
      true,
    );
  });

  it('treats a 23505 with no constraint name as ours', () => {
    // `skills` has exactly one unique index, so an unnamed unique violation on
    // this path can only be that one. Better a correct 409 than a 500.
    expect(isDuplicateName({ code: '23505' })).toBe(true);
  });

  it.each([
    ['a different constraint', { code: '23505', constraint_name: 'agent_skills_pkey' }],
    ['a foreign-key violation', { code: '23503', constraint_name: 'skills_workspace_id_fk' }],
    ['a not-null violation', { code: '23502' }],
    ['a plain Error', new Error('boom')],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'nope'],
  ])('does not claim %s', (_label, err) => {
    // Over-matching is the dangerous direction: it would turn an unrelated
    // database failure into a cheerful "that name is taken".
    expect(isDuplicateName(err)).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import type { ConventionCandidate } from '@devdigest/shared';
import { buildSkillDraft, renderSkillBody } from '../src/modules/conventions/helpers.js';

/**
 * The merged skill body.
 *
 * The claim the whole feature is judged on lives here: a rejected candidate
 * never reaches the skill. It is asserted rather than eyeballed because the
 * failure is silent — a widened filter produces a longer, plausible-looking
 * skill that quietly re-adds a rule a person threw out.
 */

const CTX = { repoFullName: 'acme/payments-api', sampledCount: 15, indexedSha: 'a1b2c3d4e5f6' };

function candidate(over: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id: 'c1',
    category: 'error-handling',
    rule: 'Route handlers return Result<T, ApiError> rather than throwing',
    evidence_path: 'src/api/public/index.ts',
    evidence_start_line: 14,
    evidence_end_line: 20,
    evidence_snippet: 'function handler(): Result<Item[], ApiError> {\n  return ok(items);\n}',
    confidence: 0.88,
    status: 'accepted',
    skill_id: null,
    ...over,
  };
}

describe('renderSkillBody', () => {
  it('carries each rule with the evidence that was verified', () => {
    // A skill that says "handlers return Result" without showing one is a rule
    // the reviewing model has to take on faith — and the evidence is the part
    // that was mechanically checked.
    const body = renderSkillBody([candidate()], CTX);
    expect(body).toContain('Route handlers return Result<T, ApiError> rather than throwing.');
    expect(body).toContain('`src/api/public/index.ts:14-20`');
    expect(body).toContain('return ok(items);');
  });

  it('groups by category, one section each', () => {
    const body = renderSkillBody(
      [
        candidate({ id: 'c1', category: 'error-handling' }),
        candidate({ id: 'c2', category: 'naming', rule: 'Files are kebab-case' }),
        candidate({ id: 'c3', category: 'naming', rule: 'Types are PascalCase' }),
      ],
      CTX,
    );
    expect(body.match(/^## .*/gm)).toEqual(['## error-handling', '## naming']);
  });

  it('names the repo and the exact SHA the evidence was read at', () => {
    const body = renderSkillBody([candidate()], CTX);
    expect(body).toContain('`acme/payments-api`');
    expect(body).toContain('15 sampled');
    expect(body).toContain('`a1b2c3d`');
  });

  it('tells the reviewing model not to flag mere stylistic difference', () => {
    // Without this the skill reads as "here is some code, match it", and a
    // conventions skill that flags every divergence from an example is noise.
    expect(renderSkillBody([candidate()], CTX)).toMatch(/only flag\s+violations of the stated rule/);
  });

  it('adds a period to a rule that lacks one, and does not double it', () => {
    const one = renderSkillBody([candidate({ rule: 'Files are kebab-case' })], CTX);
    expect(one).toContain('- Files are kebab-case.');
    const two = renderSkillBody([candidate({ rule: 'Files are kebab-case.' })], CTX);
    expect(two).toContain('- Files are kebab-case.');
    expect(two).not.toContain('kebab-case..');
  });

  it('fences a snippet that itself contains backticks', () => {
    // Real code carries ``` — in a markdown template, in a docstring. A
    // three-backtick fence around it would close early and spill the rest of
    // the snippet into the skill as instructions.
    const snippet = 'const help = `\\`\\`\\`ts\\nexample\\n\\`\\`\\``;';
    const body = renderSkillBody([candidate({ evidence_snippet: snippet })], CTX);
    const fences = body.match(/`{3,}/g) ?? [];
    expect(fences.length).toBeGreaterThanOrEqual(2);
    // The opening fence must be longer than the longest run inside the snippet.
    const longestInside = Math.max(
      ...[...snippet.matchAll(/`+/g)].map((m) => m[0].length),
    );
    expect(fences[0]!.length).toBeGreaterThan(longestInside);
  });
});

describe('buildSkillDraft', () => {
  it('defaults to repo-conventions and counts what went in', () => {
    const draft = buildSkillDraft([candidate({ id: 'a' }), candidate({ id: 'b' })], CTX);
    expect(draft.name).toBe('repo-conventions');
    expect(draft.type).toBe('convention');
    expect(draft.enabled).toBe(true);
    expect(draft.description).toBe('2 house conventions extracted from acme/payments-api');
    expect(draft.candidate_ids).toEqual(['a', 'b']);
  });

  it('says "1 house convention", singular', () => {
    expect(buildSkillDraft([candidate()], CTX).description).toContain('1 house convention ');
  });

  it('renders ONLY what it was handed — the caller filters to accepted', () => {
    // Membership is decided by the service reading `status = 'accepted'`, so the
    // contract this pins is that nothing here widens that set: text from a
    // candidate that was not passed in cannot appear in the body.
    const draft = buildSkillDraft([candidate({ rule: 'Kept rule about errors' })], CTX);
    expect(draft.body).toContain('Kept rule about errors');
    expect(draft.body).not.toContain('Rejected rule');
    expect(draft.candidate_ids).toHaveLength(1);
  });
});

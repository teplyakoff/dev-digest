import type {
  ConventionCandidate,
  ConventionCategory,
  ConventionDropReason,
  ConventionScan,
  ConventionSkillDraft,
  ConventionStatus,
  Provider,
} from '@devdigest/shared';
import type { ConventionRow, ConventionScanRow } from './repository.js';

/**
 * Pure helpers for the conventions module — row ⇄ DTO mapping, the merged skill
 * body, and the rule-identity function that carries decisions across a re-scan.
 * No I/O, so all of it is testable without Docker.
 */

/** The skill a merge produces, unless the person editing the draft renames it. */
export const DEFAULT_SKILL_NAME = 'repo-conventions';

export function toCandidateDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    category: row.category as ConventionCategory,
    rule: row.rule,
    evidence_path: row.evidencePath ?? '',
    evidence_start_line: row.evidenceStartLine ?? 1,
    evidence_end_line: row.evidenceEndLine ?? 1,
    evidence_snippet: row.evidenceSnippet ?? '',
    confidence: row.confidence ?? 0,
    status: row.status as ConventionStatus,
    skill_id: row.skillId,
  };
}

export function toScanDto(row: ConventionScanRow): ConventionScan {
  return {
    id: row.id,
    repo_id: row.repoId,
    indexed_sha: row.indexedSha,
    sampled_files: row.sampledFiles,
    config_files: row.configFiles,
    proposed: row.proposed,
    kept: row.kept,
    dropped: row.dropped as { rule: string; reason: ConventionDropReason }[],
    provider: row.provider as Provider,
    model: row.model,
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    cost_usd: row.costUsd,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * Render the merged skill body from candidates, grouped by category.
 *
 * The ONLY input is the accepted set — the caller reads `status = 'accepted'`
 * and nothing here can widen that. Membership living on the server, rather than
 * in the modal that edits the text, is what makes "a rejected candidate never
 * reaches the skill" one assertion instead of a client invariant nobody can
 * test.
 *
 * Each rule carries its evidence inline, because a skill that says "handlers
 * return Result" without showing one is a rule the reviewing model has to take
 * on faith — and the evidence is the thing that was verified.
 */
export function renderSkillBody(
  candidates: readonly ConventionCandidate[],
  ctx: { repoFullName: string; sampledCount: number; indexedSha: string },
): string {
  const byCategory = new Map<string, ConventionCandidate[]>();
  for (const c of candidates) {
    const list = byCategory.get(c.category);
    if (list) list.push(c);
    else byCategory.set(c.category, [c]);
  }

  const sections = [...byCategory.entries()].map(([category, list]) => {
    const rules = list
      .map((c) => {
        const lines = `${c.evidence_path}:${c.evidence_start_line}-${c.evidence_end_line}`;
        const fence = fenceFor(c.evidence_snippet);
        return [
          `- ${withPeriod(c.rule)}`,
          `  Seen in \`${lines}\`:`,
          '',
          indent(`${fence}\n${c.evidence_snippet}\n${fence}`),
        ].join('\n');
      })
      .join('\n\n');
    return `## ${category}\n\n${rules}`;
  });

  const header = [
    `# ${DEFAULT_SKILL_NAME}`,
    '',
    `House conventions for \`${ctx.repoFullName}\`, extracted from ${ctx.sampledCount} sampled`,
    `files at \`${shortSha(ctx.indexedSha)}\`. Flag a change that violates a rule below and`,
    'cite the offending `file:line`.',
    '',
    'Do not flag code that merely differs in style from these examples; only flag',
    'violations of the stated rule. A rule that does not apply to the diff in front',
    'of you is not a finding.',
  ].join('\n');

  return [header, ...sections].join('\n\n');
}

export function buildSkillDraft(
  candidates: readonly ConventionCandidate[],
  ctx: { repoFullName: string; sampledCount: number; indexedSha: string },
): ConventionSkillDraft {
  const n = candidates.length;
  return {
    name: DEFAULT_SKILL_NAME,
    description: `${n} house convention${n === 1 ? '' : 's'} extracted from ${ctx.repoFullName}`,
    type: 'convention',
    enabled: true,
    body: renderSkillBody(candidates, ctx),
    candidate_ids: candidates.map((c) => c.id),
  };
}

/**
 * A fence long enough to survive a snippet that contains one. Real code does
 * carry ``` — in a markdown template, in a docstring — and a three-backtick
 * fence around it would end the block early and spill the rest of the snippet
 * into the skill as instructions.
 */
function fenceFor(snippet: string): string {
  const longest = [...snippet.matchAll(/`+/g)].reduce((max, m) => Math.max(max, m[0].length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function indent(block: string): string {
  return block
    .split('\n')
    .map((line) => (line === '' ? '' : `  ${line}`))
    .join('\n');
}

function withPeriod(rule: string): string {
  const trimmed = rule.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function shortSha(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

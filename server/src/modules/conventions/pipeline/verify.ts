/**
 * Evidence verification — the step that decides whether the extractor can be
 * believed.
 *
 * The review pipeline drops a finding that does not cite a real diff line. This
 * is the same rule one layer up: a convention candidate that cannot point at
 * real code is dropped, and the score of the feature is what survives.
 *
 * Pure by construction. It is handed the exact `SampledFile` map the prompt was
 * built from, never the filesystem, so "the model cited line 90 of a file we
 * showed 60 lines of" is answerable without a clone — and a re-read that raced
 * with a checkout cannot silently validate a citation against different bytes.
 *
 * The snippet a survivor carries is SLICED FROM THAT MAP, never taken from the
 * model. The extraction schema has no field for a model-written snippet, so a
 * fabricated one is unrepresentable rather than merely unlikely.
 */
import type { ConventionCategory, ConventionDropReason } from '@devdigest/shared';
import { MAX_EVIDENCE_SPAN } from '../constants.js';
import type { SampledFile } from './samples.js';

/** What the model returns, per candidate. Note the absence of a snippet field. */
export interface ProposedCandidate {
  category: ConventionCategory;
  rule: string;
  evidence_path: string;
  evidence_start_line: number;
  evidence_end_line: number;
  confidence: number;
}

/** A candidate that pointed at real code, carrying the code it pointed at. */
export interface VerifiedCandidate extends ProposedCandidate {
  evidence_snippet: string;
}

export interface DroppedCandidate {
  rule: string;
  reason: ConventionDropReason;
}

export interface VerifyResult {
  kept: VerifiedCandidate[];
  dropped: DroppedCandidate[];
}

export function verifyCandidates(
  proposed: readonly ProposedCandidate[],
  sampled: ReadonlyMap<string, SampledFile>,
): VerifyResult {
  const kept: VerifiedCandidate[] = [];
  const dropped: DroppedCandidate[] = [];
  const seenRules = new Set<string>();

  for (const c of proposed) {
    const file = sampled.get(normalisePath(c.evidence_path));
    if (!file) {
      dropped.push({ rule: c.rule, reason: 'file_not_sampled' });
      continue;
    }

    const start = c.evidence_start_line;
    // `shownUpTo`, not `totalLines`: a citation into the truncated tail is a
    // guess about text the model never received, however real that line is.
    if (!Number.isInteger(start) || start < 1 || start > file.shownUpTo) {
      dropped.push({ rule: c.rule, reason: 'line_out_of_range' });
      continue;
    }
    const claimedEnd = c.evidence_end_line;
    if (!Number.isInteger(claimedEnd) || claimedEnd < start || claimedEnd > file.shownUpTo) {
      dropped.push({ rule: c.rule, reason: 'line_out_of_range' });
      continue;
    }

    // Clamp rather than drop: an over-long span is a badly framed citation, not
    // a false one, and the first lines of it are still the evidence.
    const end = Math.min(claimedEnd, start + MAX_EVIDENCE_SPAN - 1);
    const snippet = trimBlankEdges(file.lines.slice(start - 1, end));
    if (snippet.length === 0) {
      dropped.push({ rule: c.rule, reason: 'empty_snippet' });
      continue;
    }

    const key = normaliseRule(c.rule);
    if (seenRules.has(key)) {
      dropped.push({ rule: c.rule, reason: 'duplicate_rule' });
      continue;
    }
    seenRules.add(key);

    kept.push({
      ...c,
      evidence_end_line: end,
      evidence_snippet: snippet.join('\n'),
    });
  }

  return { kept, dropped };
}

/**
 * Forgive the two path shapes a model reliably invents — a `./` prefix and a
 * trailing `:23` or `:23-31` it copied out of the citation format it was asked
 * for. Both can only ever resolve ONTO a path that was sampled, so being lenient
 * here cannot admit a file the model never saw.
 */
export function normalisePath(path: string): string {
  return path.trim().replace(/^\.\//, '').replace(/:\d+(-\d+)?$/, '');
}

/**
 * Collapse a rule to its identity for dedupe: case, backticks, punctuation and
 * runs of whitespace all vary between two phrasings of the same rule.
 */
export function normaliseRule(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/[`'"]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Drop leading and trailing blank lines. A span whose edges are blank is usually
 * a line number guessed one or two off, and trimming means the snippet starts at
 * the code rather than at whitespace. A span that is ALL blank trims to nothing,
 * which is exactly the `empty_snippet` signal.
 *
 * Comment-only spans are deliberately kept: "every exported function carries a
 * JSDoc block" is a real convention whose only possible evidence is a comment.
 */
function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === '') start += 1;
  while (end > start && lines[end - 1]!.trim() === '') end -= 1;
  return lines.slice(start, end);
}

import type { ChatMessage } from '@devdigest/shared';
import { INJECTION_GUARD, wrapUntrusted } from '@devdigest/reviewer-core';
import { MAX_CANDIDATES, MAX_EVIDENCE_SPAN } from '../constants.js';

/**
 * The extraction prompt.
 *
 * Sampled repo files are untrusted input by exactly the definition the review
 * path uses — nobody in this workspace wrote them, and a README or a comment can
 * carry instructions aimed at a model. So they are `wrapUntrusted`-wrapped and
 * the system message carries the SHARED `INJECTION_GUARD`, imported from
 * reviewer-core rather than copied. Copying the text would satisfy the compiler
 * and break the invariant, which is that exactly one such rule exists.
 *
 * The instructions are mostly negative on purpose. The failure mode of this
 * feature is not too few candidates, it is confident nonsense: a "rule" that is
 * one file's habit, or a citation to a line the model reconstructed rather than
 * read. Verification catches the second; only the prompt can discourage the
 * first.
 */

const SYSTEM = `You are reading a sample of one repository to find its HOUSE CONVENTIONS —
the rules this team follows so consistently that a reviewer should flag a change
that breaks one.

WHAT COUNTS
- A pattern repeated across the sample: how errors are handled, how modules are
  named, what a route handler returns, where a dependency is reached through,
  how types are declared, how imports are ordered.
- A rule a config file states outright (a lint rule, a tsconfig flag, a
  formatter setting) AND that the code visibly obeys.

WHAT DOES NOT COUNT — do not report these
- Something you saw exactly once. One file's habit is not a convention.
- A general best practice that this repo does not particularly demonstrate.
  "Use meaningful variable names" is true everywhere and says nothing here.
- The absence of something. You are describing what this repo DOES.
- Anything you cannot point at with a file and a line range from the sample.

EVIDENCE — this is mechanically checked, and a candidate that fails is discarded
- \`evidence_path\` must be one of the file paths shown in the sample, copied
  exactly.
- \`evidence_start_line\` / \`evidence_end_line\` must be line numbers you can SEE
  in the left gutter of that file's block. Every line is numbered. Do not
  estimate, do not count, read the number.
- A file header saying "lines 1-180 of 412, truncated" means lines 181+ were NOT
  sent to you. Citing them is a guess and will be discarded.
- Cite the NARROWEST span that shows the rule — at most ${MAX_EVIDENCE_SPAN} lines.
- Do not quote the code back. The snippet is read from the file by the caller;
  you only say where to look.

CONFIDENCE
Report your real confidence. 0.9+ means the sample shows this repeatedly and
unambiguously; 0.6 means it looks like a pattern but you saw it in few places.
A confident wrong rule costs more than a missing one.

Return at most ${MAX_CANDIDATES} candidates, and prefer fewer strong ones over more weak
ones. An empty list is a valid answer for a sample with no clear conventions.

${INJECTION_GUARD}`;

export interface ExtractionPromptInput {
  repoFullName: string;
  /** Rendered by `buildSampleBlock` — line-numbered, with truncation notices. */
  sampleText: string;
}

export function buildExtractionMessages(input: ExtractionPromptInput): ChatMessage[] {
  const user = [
    `Repository: ${input.repoFullName}`,
    '',
    'Below is a sample of the repository: its config files, then its highest-ranked',
    'source files. Every line is numbered. Find the house conventions this sample',
    'demonstrates and cite each one.',
    '',
    wrapUntrusted('repo sample', input.sampleText),
  ].join('\n');

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ];
}

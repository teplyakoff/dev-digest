import type { ChatMessage } from '@devdigest/shared';
import { INJECTION_GUARD, wrapUntrusted } from '@devdigest/reviewer-core';
import { MAX_SCOPE_ITEMS, MAX_SCOPE_ITEM_CHARS } from '../constants.js';
import type { CollectedBlock } from './sources.js';

/**
 * The classifier prompt.
 *
 * This is the product's SECOND untrusted-input→model path (the first being the
 * Conventions Extractor), and the third overall counting the review itself. A PR
 * title, a description, a linked ticket and a plan file are all written by
 * people outside this workspace, and any of them can carry text aimed at a
 * model. So every block is `wrapUntrusted`-wrapped and the system message ends
 * with the SHARED `INJECTION_GUARD`, IMPORTED from reviewer-core rather than
 * copied. Copying the text compiles and breaks the invariant, which is that
 * exactly one such rule exists.
 *
 * The instructions are mostly negative, for the same reason the extractor's are:
 * the failure mode is not a thin summary, it is a confident one — a scope list
 * that describes what the model assumes a PR like this does rather than what
 * this PR's inputs actually say.
 */

const SYSTEM = `You are reading the inputs of ONE pull request to state what it is FOR.

WHAT YOU PRODUCE
- summary: one or two sentences, in the PR author's own framing, saying what
  this PR sets out to change and why. Not a description of the code.
- in_scope: short noun phrases naming what this PR is trying to do.
- out_of_scope: short noun phrases naming what this PR DELIBERATELY does not do
  — a follow-up the author named, a rewrite they explicitly deferred, a concern
  they said they were leaving alone.
- confidence: how well the inputs actually support the above.

RULES THAT DECIDE WHETHER THIS IS USEFUL
- out_of_scope means "this PR chose not to do X". It does NOT mean "things I was
  not shown". If the inputs name no deliberate exclusion, return an empty list.
  Listing what you could not see there is the single worst thing you can do,
  because a later step treats out_of_scope as the author's decision.
- The changed-file list carries file paths and HUNK HEADERS ONLY — the ranges
  that changed, never the changed lines. You can see WHERE the PR touches and
  HOW MUCH; you cannot see what the code does. Do not claim otherwise.
- A missing description is a valid state to reason from. Title, file paths and
  hunk headers are still evidence. Say less, do not guess more.
- Anything listed as unavailable was genuinely not fetched. Do not reconstruct
  it, do not assume its contents, and do not let its absence become an
  out_of_scope item.
- At most ${MAX_SCOPE_ITEMS} items per list, each under ${MAX_SCOPE_ITEM_CHARS} characters. Phrases, not
  sentences, and never instructions.

CONFIDENCE — report it honestly, it is used
- high: a description or a linked ticket states the purpose, and the changed
  files are consistent with it.
- medium: the purpose is inferable but nothing states it outright.
- low: you are working from a title and a file list, or the inputs disagree.
A confident wrong summary costs more than a hedged one: the next model in this
pipeline reads your answer as the frame for its whole review.

${INJECTION_GUARD}`;

export interface IntentPromptInput {
  repoFullName: string;
  prNumber: number;
  title: string;
  /** Every collected block, already capped, in the order it should be read. */
  blocks: CollectedBlock[];
  /** Plain-language list of what could NOT be fetched. */
  missingContext: string[];
}

export function buildIntentMessages(input: IntentPromptInput): ChatMessage[] {
  const parts: string[] = [
    `Repository: ${input.repoFullName}`,
    `Pull request: #${input.prNumber}`,
    '',
    'Title:',
    wrapUntrusted('pr-title', input.title),
  ];

  for (const block of input.blocks) {
    parts.push('', wrapUntrusted(block.label, block.text));
  }

  // Naming the gaps explicitly is what stops the model inventing what fills
  // them. It is also this design's own reasoning rather than borrowed practice:
  // none of the surveyed AI review products documents what it does when a linked
  // ticket is unreachable.
  parts.push(
    '',
    input.missingContext.length > 0
      ? [
          'COULD NOT BE READ — these were named but never fetched. Reason from',
          'their absence; do not reconstruct them and do not list them as',
          'out-of-scope:',
          ...input.missingContext.map((m) => `- ${m}`),
        ].join('\n')
      : 'Everything this PR named was fetched successfully.',
  );

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: parts.join('\n') },
  ];
}

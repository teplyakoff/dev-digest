import type { ChatMessage } from '@devdigest/shared';
import { INJECTION_GUARD, wrapUntrusted } from '@devdigest/reviewer-core';
import { renderBriefBlocks, type CollectedInput } from './sources.js';

/**
 * The brief prompt — assembly, and nothing else.
 *
 * PURE, AND FOR TWO CONCRETE REASONS. `pipeline/budget.ts` calls this again
 * after every drop level, and `src/tools/measure-brief-input.ts` measures its
 * output; both need "what would actually be sent" for an input they hold in
 * their hand, with no I/O and no container in the way.
 *
 * THE UNIT NFR-1 NORMS IS THE ASSEMBLED MESSAGES, not the blocks that feed them.
 * The system message, the guard, the wrappers and the block captions weigh as
 * much as the content on a small PR, so a budget measured over blocks alone
 * reports ≤8 000 while what leaves the process is over.
 *
 * THE GUARD IS IMPORTED, NEVER COPIED (NFR-4). `INJECTION_GUARD` and
 * `wrapUntrusted` come from the engine exactly as `intent/pipeline/prompt.ts`
 * takes them. A copy of the text compiles, passes every test, and quietly ends
 * the invariant that one such rule exists.
 *
 * TWO UNTRUSTED SURFACES ARE NEW HERE and neither existed in an earlier prompt:
 * repository paths out of the code index, and HTTP route strings extracted from
 * source. Both are attacker-reachable through a pull request that adds a file or
 * a route, and both are inside wrappers below like everything else.
 */

const SYSTEM = `You are writing a REVIEWER'S BRIEF for one pull request: what it
changes, why, and where it is most likely to break.

WHAT YOU PRODUCE
- what: one or two sentences naming the change itself. Concrete, not a restating
  of the PR title in other words.
- why: one or two sentences on the purpose the inputs actually support.
- risk_level: high, medium or low — the single headline for this PR.
- risks: the specific ways this diff can break something, worst first. Each risk
  names the files or endpoints it is about.
- review_focus: the files worth opening first, each with a short reason.

WHAT YOU CAN AND CANNOT SEE
- You are shown file paths, per-file line counts, the impact map from the code
  index, and the PR's stated intent. You are NOT shown the diff hunks. You can
  see WHERE this PR touches and HOW MUCH; you cannot see what the new code says.
  A risk phrased as if you had read the code is a wrong risk, however plausible.
- Anything listed as unavailable was genuinely not fetched. Reason from its
  absence; do not reconstruct it.

RULES THAT DECIDE WHETHER THIS IS USEFUL
- Every risk must name at least one file path or endpoint taken from the input
  above. A risk that names nothing cannot be checked by a reader and is dropped
  before it reaches them.
- review_focus entries are FILE PATHS from the changed-file list or the impact
  map — never an endpoint route, never a line number.
- Do not restate the PR title as the summary. If the inputs only support a thin
  brief, write a thin one; a confident invented risk costs more than a missing
  one, because a reviewer acts on it.
- risk_level is about this diff's blast radius and reversibility, not about how
  large the diff is.

${INJECTION_GUARD}`;

/**
 * Assemble the exact messages the provider will receive.
 *
 * EVERY BLOCK GOES THROUGH `wrapUntrusted`, the PR title included (AC-35,
 * NFR-4). The title is a block rather than a header line precisely so this loop
 * covers it: text folded into the framing above would be untrusted content
 * inside the system's own voice, and invisible to a guard test that enumerates
 * blocks.
 *
 * The guard is the LAST thing in the system message (AC-60) — it closes the
 * instructions, so nothing the model reads afterwards is a rule it was given.
 */
export function assembleBriefMessages(input: CollectedInput): ChatMessage[] {
  const blocks = renderBriefBlocks(input);
  const parts: string[] = [];

  for (const block of blocks) {
    parts.push(wrapUntrusted(block.name, block.text), '');
  }

  // THE INSTRUCTION IS TRUSTED; THE LIST IS NOT. Each item names something that
  // came out of a PR author's text — an issue ref, a note from GitHub — so the
  // items go inside the delimiter and only the framing stays outside it. The
  // same split `intent/pipeline/prompt.ts` had to make after shipping it wrong.
  parts.push(
    input.unavailableInputs.length > 0
      ? [
          'COULD NOT BE READ — these were named but never fetched. Reason from',
          'their absence; do not reconstruct them:',
          wrapUntrusted(
            'unavailable-inputs',
            input.unavailableInputs.map((m) => `- ${m}`).join('\n'),
          ),
        ].join('\n')
      : 'Everything this PR named was fetched successfully.',
  );

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: parts.join('\n') },
  ];
}

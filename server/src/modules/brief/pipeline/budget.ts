import type { ChatMessage } from '@devdigest/shared';
import type { Tokenizer } from '../../../adapters/tokenizer/index.js';
import { AppError } from '../../../platform/errors.js';
import {
  MAX_CALLERS_IN_BRIEF,
  MAX_FILE_STATS_IN_BRIEF,
  UNDROPPABLE_BLOCKS,
  type UndroppableBlock,
} from '../constants.js';
import type { CollectedInput } from './sources.js';

/**
 * The token budget and its drop levels.
 *
 * PURE, NO CONTAINER (onion §7). Everything it needs arrives as an argument —
 * the input, the assembler, a token counter, a number — so the rule is testable
 * with no database, no adapters and no app. A `container` reference inside any
 * function here would be the Service Locator smell §6 names.
 *
 * WHAT IS MEASURED IS WHAT WILL BE SENT. After every drop the input is
 * RE-ASSEMBLED and the messages are re-counted, because NFR-1 norms "the
 * assembled system and user messages" and nothing smaller. A budget measured
 * over the blocks alone happily reports 7 900 while the request that leaves the
 * process carries 9 500 — the system prompt, the guard, the wrappers and the
 * captions are not free.
 *
 * COUNTED, NOT ESTIMATED (AC-22). `tokenizer.count`, never `length / 4`. The
 * heuristic is the tokenizer's own fallback when the BPE ranks fail to load, and
 * that is its only sanctioned use.
 *
 * EVERY APPLIED DROP IS REPORTED (AC-25, NFR-8). This is also why levels 4 and 5
 * cannot be caps in the renderer: what the renderer trims never reaches
 * `dropped`, so the user is never told the list was short — the exact defect
 * `BlastResponse.counts` had when it counted after its own slice.
 */

/**
 * Nothing fits, after every level (AC-26).
 *
 * A LOUD failure, deliberately: the alternative is a brief built on an input
 * silently cut to size, which is a confident answer about a PR the model only
 * half saw. 409 rather than 422 — the request is well-formed, the world
 * disagrees.
 *
 * Declared here rather than in an `errors.ts` because `eslint.config.js`
 * enumerates the ring globs by literal FILENAME: a module file named anything
 * outside that list is covered by no rule at all (`server/INSIGHTS.md`,
 * 2026-08-08). `pipeline/**` is on the list; `errors.ts` is not.
 */
export class BriefInputTooLargeError extends AppError {
  constructor(tokens: number, budget: number, dropped: string[]) {
    super(
      'brief_input_too_large',
      `The brief input is ${tokens} tokens after every reduction, over the ${budget} budget`,
      409,
      { tokens, budget, dropped },
    );
  }
}

export interface FitResult {
  /** Exactly what to send. */
  messages: ChatMessage[];
  /**
   * The input those messages were built from — reduced. GROUNDING USES THIS ONE,
   * not the collected original: an allowlist built from endpoints the model was
   * never shown would accept a citation it had no way to make honestly.
   */
  input: CollectedInput;
  /** Names of what was dropped, in the order it was dropped (AC-25). */
  dropped: string[];
  /** The final measurement, for the log and for the measuring CLI. */
  tokens: number;
}

/**
 * One reduction step, or `null` when this level has nothing left to give.
 *
 * A LEVEL IS A GENERATOR, NOT A SWITCH, and that is what makes AC-23
 * enforceable: `fitToBudget` keeps asking the current level for another step
 * until it answers `null`, and only then moves on. An implementation that walked
 * the levels once, applying each if over budget, would drop endpoints while
 * documents were still in the prompt — which is the case
 * `test_brief_budget_order` exists to fail.
 */
type Level = (input: CollectedInput) => { input: CollectedInput; dropped: string } | null;

/** Level 1 — project-context documents, WHOLE, from the end of the name order (AC-61). */
const dropOneDocument: Level = (input) => {
  if (input.contextDocs.length === 0) return null;
  const docs = [...input.contextDocs];
  const removed = docs.pop()!;
  // Named individually rather than as a bare `context-docs`, because "which
  // documents did the model not see" is the question a reader of this list is
  // actually asking, and one document is one drop.
  return { input: { ...input, contextDocs: docs }, dropped: `context-docs:${removed.name}` };
};

/** Level 2 — cron entries (AC-62). Atomic: one step exhausts it. */
const dropCrons: Level = (input) => {
  if (input.blast.crons.length === 0) return null;
  return {
    input: { ...input, blast: { ...input.blast, crons: [] } },
    dropped: 'blast-crons',
  };
};

/** Level 3 — endpoints (AC-63). Atomic. */
const dropEndpoints: Level = (input) => {
  if (input.blast.endpoints.length === 0) return null;
  return {
    input: { ...input, blast: { ...input.blast, endpoints: [] } },
    dropped: 'blast-endpoints',
  };
};

/**
 * Level 4 — callers beyond five PER SYMBOL (AC-64).
 *
 * Per symbol, never `slice(0, 5)` over the flat list: the flat form gives a
 * five-symbol PR five callers in total and renders four symbols as having none,
 * and "nothing calls this" is a claim a reviewer acts on.
 *
 * `callers_total` is deliberately NOT lowered. It is the field that lets the
 * renderer say "showing 5" next to a real total; recomputing it after the cut is
 * how a truncated list starts reporting its own length as the truth.
 */
const capCallersPerSymbol: Level = (input) => {
  if (!input.blast.symbols.some((s) => s.callers.length > MAX_CALLERS_IN_BRIEF)) return null;
  const symbols = input.blast.symbols.map((s) => ({
    ...s,
    callers: [...s.callers]
      .sort((a, b) => b.rank - a.rank || a.file.localeCompare(b.file) || a.line - b.line)
      .slice(0, MAX_CALLERS_IN_BRIEF),
  }));
  return {
    input: { ...input, blast: { ...input.blast, symbols } },
    dropped: 'blast-symbols',
  };
};

/**
 * Level 5 — the `+/−` NUMBERS beyond the 50 largest files (AC-65).
 *
 * IT DROPS THE NUMBERS, NOT THE FILES, and that distinction is the whole point
 * of the level. The paths of changed files live in the prompt in exactly one
 * block, together with those numbers, so a level that trimmed the block to fifty
 * ENTRIES would drop 150 paths on a 200-file PR — honestly for `dropped`, and
 * silently for AC-24, which forbids exactly that. Worse, it is not only a
 * display loss: the grounding allowlist is built from these paths (AC-7), so a
 * shortened list narrows AC-9 and AC-68 into rejecting correct citations of
 * files the model was never shown. Every path survives; the sizes are what this
 * level buys the budget.
 *
 * "Largest" is defined by the sort `collectBriefInput` already applied
 * (`additions + deletions` DESC, path ASC); a PR's files have no inherent order,
 * so without that sort this level would keep an arbitrary fifty.
 */
const capFileStatSizes: Level = (input) => {
  // Already applied — one shot, so this level is exhausted after it fires once.
  if (input.fileStatSizesFor !== null) return null;
  if (input.fileStats.length <= MAX_FILE_STATS_IN_BRIEF) return null;
  return {
    input: { ...input, fileStatSizesFor: MAX_FILE_STATS_IN_BRIEF },
    // Qualified, because a bare `file-stats` would tell the reader the block is
    // gone when the paths are all still there. What was given up is the sizes.
    dropped: 'file-stats:numbers',
  };
};

/** Level 6 — the linked issue's text (AC-66). Atomic, and the last thing to go. */
const dropLinkedIssue: Level = (input) => {
  if (!input.linkedIssue) return null;
  return { input: { ...input, linkedIssue: null }, dropped: 'linked-issue' };
};

/**
 * The levels, in the only order they may be applied.
 *
 * NOT IN THIS LIST, at any level: the PR title, the intent summary with its
 * scope lists, and the PATH of every changed file (AC-24). They are undroppable
 * by construction — no level touches them — AND that is checked after every
 * step by `assertUndroppableIntact` below, because "no level touches them" is a
 * claim about code that will be edited by someone who has not read this comment.
 */
const LEVELS: Level[] = [
  dropOneDocument,
  dropCrons,
  dropEndpoints,
  capCallersPerSymbol,
  capFileStatSizes,
  dropLinkedIssue,
];

/**
 * What must survive a level untouched, per undroppable block (AC-24).
 *
 * An identity function rather than the rendered block, and the difference is
 * exactly the bug this guard was written for: level 5 legitimately removes the
 * `+/−` numbers from `file-stats`, so comparing the RENDERED block would either
 * forbid a legal level or — if relaxed to mere presence — prove nothing at all,
 * since a block with 50 of 200 paths is just as present as one with all 200.
 * The identity is therefore the list of PATHS, which is what AC-24 actually
 * protects and what the grounding allowlist is built from.
 */
const UNDROPPABLE_IDENTITY: Record<UndroppableBlock, (input: CollectedInput) => string> = {
  'pr-title': (i) => i.prTitle,
  intent: (i) => i.intentBlock ?? '',
  'file-stats': (i) => i.fileStats.map((f) => f.path).join('\n'),
};

/**
 * AC-24, checked rather than promised.
 *
 * Runs after every applied level. "No level touches these" is a claim about
 * code, and code gets edited by someone who has not read the comment above
 * `LEVELS` — which is precisely how level 5 came to trim paths while its own
 * doc-comment said the list was undroppable. A plain `Error`, not a taxonomy
 * one: reaching it means this module is internally inconsistent, which is a
 * 500 and a bug report, never something a caller can fix by asking differently.
 */
export function assertUndroppableIntact(
  original: CollectedInput,
  current: CollectedInput,
  level: number,
): void {
  for (const name of UNDROPPABLE_BLOCKS) {
    const identity = UNDROPPABLE_IDENTITY[name];
    if (identity(original) !== identity(current)) {
      throw new Error(
        `brief budget: level ${level} altered '${name}', which AC-24 makes undroppable`,
      );
    }
  }
}

/**
 * Reduce `input` until its ASSEMBLED messages fit `budget`, or fail loudly.
 *
 * @param assemble `assembleBriefMessages` — passed in rather than imported so
 *   this stays a pure rule over "whatever the prompt currently is", and so a
 *   test can measure the levels without the real system prompt in the way.
 */
export function fitToBudget(
  input: CollectedInput,
  assemble: (input: CollectedInput) => ChatMessage[],
  tokenizer: Tokenizer,
  budget: number,
): FitResult {
  const measure = (i: CollectedInput) => {
    const messages = assemble(i);
    return {
      messages,
      tokens: messages.reduce((n, m) => n + tokenizer.count(m.content), 0),
    };
  };

  let current = input;
  let { messages, tokens } = measure(current);
  const dropped: string[] = [];

  for (const [index, level] of LEVELS.entries()) {
    // EXHAUST THIS LEVEL BEFORE LOOKING AT THE NEXT (AC-23). The inner loop
    // stops for one of two reasons and they are not the same: we now fit, or
    // this level has nothing left. Only the second lets the outer loop advance.
    while (tokens > budget) {
      const step = level(current);
      if (step === null) break;
      current = step.input;
      assertUndroppableIntact(input, current, index + 1);
      dropped.push(step.dropped);
      ({ messages, tokens } = measure(current));
    }
    if (tokens <= budget) break;
  }

  if (tokens > budget) throw new BriefInputTooLargeError(tokens, budget, dropped);

  return { messages, input: current, dropped, tokens };
}

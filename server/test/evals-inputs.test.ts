import { describe, it, expect } from 'vitest';
import type { LLMProvider } from '@devdigest/shared';
import type { ReviewInput } from '@devdigest/reviewer-core';
import {
  EvalInvariantError,
  assertScopeFilterDisarmed,
  buildEvalReviewInput,
} from '../src/modules/evals/helpers.js';
import { EVAL_REVIEW_STRATEGY } from '../src/modules/evals/constants.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';

/**
 * L06 / SPEC-08 — WHAT THE ENGINE SEES on an eval run (AC-44, AC-46,
 * AC-102…AC-106), hermetically.
 *
 * The object literal `buildEvalReviewInput` returns IS the criterion, so this
 * file asserts on its shape rather than on anything downstream. Five of the six
 * criteria here are absence criteria, and absence is the one thing a test that
 * "looks at the prompt" cannot prove: a missing `repoMap` and an empty
 * `repoMap` render the same prompt today, and stop doing so the moment the
 * engine renders an empty section. So each is pinned as a property that is not
 * on the object.
 *
 * NO DOCKER.
 */

/**
 * A provider that throws on every method.
 *
 * `buildEvalReviewInput` carries the port but must never reach it — the input
 * is assembled, not executed. A stub that returned a fixture would leave "did
 * assembly call the model?" unanswered; this one makes the answer loud.
 */
class ThrowingLLM implements LLMProvider {
  readonly id = 'openrouter' as const;
  listModels(): never {
    throw new Error('buildEvalReviewInput called listModels — assembly makes no model call');
  }
  complete(): never {
    throw new Error('buildEvalReviewInput called complete — assembly makes no model call');
  }
  completeStructured(): never {
    throw new Error('buildEvalReviewInput called completeStructured — assembly makes no model call');
  }
  embed(): never {
    throw new Error('buildEvalReviewInput called embed — assembly makes no model call');
  }
}

const DIFF = parseUnifiedDiff(
  [
    'diff --git a/src/config.ts b/src/config.ts',
    '--- a/src/config.ts',
    '+++ b/src/config.ts',
    '@@ -10,3 +10,4 @@',
    '   port: 3000,',
    '+  stripeKey: "sk_live_xxx",',
    '   redisUrl: x,',
  ].join('\n'),
);

const AGENT = {
  systemPrompt: 'You are the Security Reviewer.',
  model: 'deepseek/deepseek-v4-flash',
  skills: ['## Skill: secret-handling\nNever accept a literal key.'],
};

function build(): ReviewInput {
  return buildEvalReviewInput({ ...AGENT, diff: DIFF, llm: new ThrowingLLM() });
}

describe('buildEvalReviewInput — the three inputs it DOES take (AC-44)', () => {
  it('passes the agent’s system prompt, model and resolved skill bodies, verbatim', () => {
    const input = build();

    expect(input.systemPrompt).toBe(AGENT.systemPrompt);
    expect(input.model).toBe(AGENT.model);
    // The resolved BODIES, not slugs — a slug reaching the engine renders as
    // prose the model cannot act on, and nothing else would go red.
    expect(input.skills).toEqual(AGENT.skills);
  });

  it('carries exactly the keys an eval run is allowed to carry, and no others', () => {
    // The whole-key-set assertion is what makes AC-102…AC-106 durable: the five
    // named absences below each catch their own field, and this catches the
    // SIXTH field somebody adds next. `specs` is absent here too — a case
    // carries its own diff and nothing else, which is what makes two batches of
    // the same set comparable at all.
    expect(Object.keys(build()).sort()).toEqual([
      'diff',
      'llm',
      'model',
      'skills',
      'strategy',
      'systemPrompt',
    ]);
  });

  it('fixes the strategy to single-pass rather than reading it from the agent (NFR-5)', () => {
    // One case = one chunk = one model call. `map-reduce` would make one call
    // per file and quietly break "exactly N calls for N cases".
    expect(build().strategy).toBe(EVAL_REVIEW_STRATEGY);
    expect(EVAL_REVIEW_STRATEGY).toBe('single-pass');
  });

  it('forwards an abort signal when one is supplied, and omits the key when not', () => {
    const controller = new AbortController();
    const withSignal = buildEvalReviewInput({
      ...AGENT,
      diff: DIFF,
      llm: new ThrowingLLM(),
      signal: controller.signal,
    });

    expect(withSignal.signal).toBe(controller.signal);
    // `signal: undefined` would satisfy `.signal` reads and still be a key the
    // set assertion above must not see on the default path.
    expect(build()).not.toHaveProperty('signal');
  });
});

/**
 * AC-102…AC-106 — one criterion per omitted engine input, so one verdict per
 * criterion. These were a single compound AC-45 until the spec was amended; the
 * five names below are the amendment.
 *
 * `not.toHaveProperty` and not `toBeUndefined`: `{ repoMap: undefined }` passes
 * the second and fails the first, and the difference is exactly the failure
 * mode — a field spread in from a config object with a missing value.
 */
describe('buildEvalReviewInput — the five inputs it must NOT take', () => {
  it('does not pass the repository map (AC-102)', () => {
    expect(build()).not.toHaveProperty('repoMap');
  });

  it('does not pass memory (AC-103)', () => {
    expect(build()).not.toHaveProperty('memory');
  });

  it('does not pass callers (AC-104)', () => {
    expect(build()).not.toHaveProperty('callers');
  });

  it('does not pass the derived intent (AC-105)', () => {
    // Load-bearing beyond the criterion: `assemblePrompt` appends SCOPE_RULE to
    // the system message whenever `intent` is set, so an intent here changes the
    // very prompt two batches are supposed to be compared across.
    expect(build()).not.toHaveProperty('intent');
  });

  it('does not pass the PR description (AC-106)', () => {
    expect(build()).not.toHaveProperty('prDescription');
  });
});

/**
 * AC-46 — the scope gate is never armed, and that is a THROW rather than a
 * comment.
 *
 * The identity `citation_accuracy = kept / (kept + dropped)` holds only while
 * `applyScopeFilter` is the disarmed pass-through. Arm it and the number
 * silently starts measuring something else; nothing anywhere else in the system
 * goes red. This is the first half of the criterion — that arming throws. The
 * second half — that the throw ESCAPES the batch runner instead of degrading
 * into one more `errored` row — is pinned in `evals-batch.it.test.ts`, because
 * it is a property of the runner's catch clause and needs a real batch.
 */
describe('assertScopeFilterDisarmed (AC-46)', () => {
  const base = (): ReviewInput => ({
    systemPrompt: AGENT.systemPrompt,
    model: AGENT.model,
    diff: DIFF,
    llm: new ThrowingLLM(),
  });

  it('throws EvalInvariantError when scopeFilter is armed', () => {
    expect(() => assertScopeFilterDisarmed({ ...base(), scopeFilter: true })).toThrow(
      EvalInvariantError,
    );
  });

  it('names the identity it is protecting, so the throw is diagnosable', () => {
    // A bare `throw new Error('invariant')` would stop the batch and tell the
    // next reader nothing about why citation_accuracy cannot be trusted.
    expect(() => assertScopeFilterDisarmed({ ...base(), scopeFilter: true })).toThrow(
      /citation_accuracy/,
    );
  });

  it('throws when an intent is set, because that arms SCOPE_RULE in the prompt', () => {
    expect(() => assertScopeFilterDisarmed({ ...base(), intent: 'adds rate limiting' })).toThrow(
      EvalInvariantError,
    );
  });

  it('accepts the input the eval path actually builds', () => {
    expect(() => assertScopeFilterDisarmed(build())).not.toThrow();
    expect(build()).not.toHaveProperty('scopeFilter');
  });

  it('is an error class the runner can single out, not a bare Error', () => {
    // The runner turns a thrown case into an `errored` row and carries on. It
    // can only re-throw this one if the class is distinguishable at runtime.
    const err = new EvalInvariantError('x');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('EvalInvariantError');
  });
});

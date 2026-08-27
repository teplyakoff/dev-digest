import { describe, it, expect } from 'vitest';
import { evalTraceLine } from '../src/modules/evals/helpers.js';
import { EVAL_TRACE_ROLE } from '../src/modules/evals/constants.js';

/**
 * L06 / SPEC-08 — NFR-7: an eval run's model calls are labelled by ROLE in the
 * trace, not by the model slug.
 *
 * The reason the slug is not enough is the whole requirement: an eval run and a
 * PR review of the SAME agent use the same provider and the same model, so
 * `openrouter/deepseek-v4-flash` in a trace says nothing about which one spent
 * the money. Same technique as `INTENT CLASSIFIER`.
 *
 * The runtime half — that the batch runner actually emits this line, once per
 * case — is `evals-batch.it.test.ts`.
 *
 * NO DOCKER.
 */

describe('evalTraceLine (NFR-7)', () => {
  it('leads with the EVAL RUN role, so a trace reader can separate the spend', () => {
    const line = evalTraceLine('Hardcoded key — src/config.ts:11-11', 'openrouter', 'x/y');

    expect(line.startsWith(EVAL_TRACE_ROLE)).toBe(true);
    expect(EVAL_TRACE_ROLE).toBe('EVAL RUN');
  });

  it('still carries the provider and model that were actually used', () => {
    // The role replaces the slug as the IDENTIFIER, it does not replace the
    // slug as information — a batch compared across two models needs both.
    const line = evalTraceLine('case A', 'openrouter', 'deepseek/deepseek-v4-flash');

    expect(line).toContain('openrouter/deepseek/deepseek-v4-flash');
  });

  it('names the case, so one line of a batch is attributable to one case', () => {
    const line = evalTraceLine('Missing tenant filter — src/db.ts:52-52', 'openai', 'gpt-4.1');

    expect(line).toContain('Missing tenant filter — src/db.ts:52-52');
  });

  it('produces a distinct line per case rather than one line per batch', () => {
    const a = evalTraceLine('case A', 'openai', 'gpt-4.1');
    const b = evalTraceLine('case B', 'openai', 'gpt-4.1');

    expect(a).not.toBe(b);
  });
});

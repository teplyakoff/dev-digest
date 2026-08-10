import { describe, it, expect } from 'vitest';
import type { LLMProvider, StructuredResult } from '@devdigest/shared';
import { MockLLMProvider, MockGitClient } from '../../server/src/adapters/mocks.js';
import { reviewPullRequest } from '../src/index.js';

/**
 * Engine-level test for reviewPullRequest (the core lifted out of the server's
 * runOneAgent). Uses the server's mock LLM + git so we exercise the real
 * assemble → completeStructured → reduce → grounding pipeline with no DB/SSE.
 */
describe('reviewPullRequest (engine)', () => {
  // One grounded finding (line 11 is in the MockGitClient diff) + one
  // hallucinated finding (line 999) the grounding gate must drop.
  const fixture = {
    verdict: 'request_changes',
    summary: 'secret key committed',
    score: 38,
    findings: [
      {
        id: 'f1',
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        rationale: 'sk_live in diff',
        confidence: 0.98,
        kind: 'finding',
      },
      {
        id: 'f-hallucinated',
        severity: 'WARNING',
        category: 'bug',
        title: 'phantom finding on a line not in the diff',
        file: 'src/config.ts',
        start_line: 999,
        end_line: 999,
        rationale: 'not real',
        confidence: 0.3,
        kind: 'finding',
      },
    ],
  };

  it('single-pass: assembles, grounds, drops the hallucinated finding', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();

    const events: string[] = [];
    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'gpt-4.1',
      diff,
      llm,
      task: 'Review PR #482',
      onEvent: (e) => events.push(e.msg),
    });

    expect(outcome.mode).toBe('single-pass');
    expect(outcome.grounding).toBe('1/2 passed');
    expect(outcome.review.findings).toHaveLength(1);
    expect(outcome.review.findings[0]!.start_line).toBe(11);
    expect(outcome.dropped).toHaveLength(1);
    // Score is derived from the SURVIVING findings, not the model's self-reported
    // 38: one CRITICAL remains after grounding ⇒ 100 − 35 = 65.
    expect(outcome.review.score).toBe(65);
    // progress is surfaced (server bridges this onto SSE; runner logs it)
    expect(events.some((m) => m.includes('Citation grounding'))).toBe(true);
  });

  it('score is deterministic from findings: a clean approve scores 100', async () => {
    // Model "approves" but reports a nonsense low score (the cheap-model bug).
    // The engine must ignore that and score the zero findings as a perfect 100.
    const clean = { verdict: 'approve', summary: 'looks good', score: 10, findings: [] };
    const llm = new MockLLMProvider('openai', { structured: clean });
    const diff = await new MockGitClient().diff();

    const outcome = await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'deepseek/deepseek-v4-flash',
      diff,
      llm,
      task: 'Review PR #5',
    });

    expect(outcome.review.findings).toHaveLength(0);
    expect(outcome.review.score).toBe(100);
  });

  it('checkCancelled throwing aborts before the LLM call', async () => {
    const llm = new MockLLMProvider('openai', { structured: fixture });
    const diff = await new MockGitClient().diff();
    await expect(
      reviewPullRequest({
        systemPrompt: 's',
        model: 'gpt-4.1',
        diff,
        llm,
        checkCancelled: () => {
          throw new Error('cancelled');
        },
      }),
    ).rejects.toThrow('cancelled');
  });

  it('scope filter runs AFTER grounding, and the score comes from ITS survivors', async () => {
    // The invariant, end to end: grounding drops the phantom, the scope gate
    // then drops the tagged-out-of-scope WARNING, and the score is recomputed
    // from what is left — not from the model's number, and not from the
    // post-grounding set the gate has since narrowed.
    const scoped = {
      verdict: 'request_changes',
      summary: 'mixed',
      score: 11,
      findings: [
        { ...fixture.findings[0]!, scope: 'in_scope' },
        // Grounded (line 11 is in the diff) but out of the PR's stated scope.
        {
          id: 'f-oos',
          severity: 'WARNING',
          category: 'style',
          title: 'unrelated naming nit',
          file: 'src/config.ts',
          start_line: 11,
          end_line: 11,
          rationale: 'pre-existing',
          confidence: 0.5,
          kind: 'finding',
          scope: 'out_of_scope',
        },
        // Ungrounded — grounding must still drop this before the gate sees it.
        { ...fixture.findings[1]!, scope: 'in_scope' },
      ],
    };
    const llm = new MockLLMProvider('openai', { structured: scoped });
    const diff = await new MockGitClient().diff();
    const events: string[] = [];

    const outcome = await reviewPullRequest({
      systemPrompt: 's',
      model: 'm',
      diff,
      llm,
      intent: 'Stated purpose: rotate the Stripe key.',
      scopeFilter: true,
      onEvent: (e) => events.push(e.msg),
    });

    // Grounding still reports over the PRE-filter set: 2 of 3 cited real lines.
    expect(outcome.grounding).toBe('2/3 passed');
    expect(outcome.review.findings.map((f) => f.title)).toEqual(['Hardcoded Stripe secret key']);
    // One CRITICAL survivor ⇒ 100 − 35. If the score had been taken from the
    // post-grounding set it would read 53 (a WARNING costs 12).
    expect(outcome.review.score).toBe(65);
    expect(events.some((m) => m.includes('scope filter dropped'))).toBe(true);
    expect(events.some((m) => m.includes('Scope filter: 1/2 kept'))).toBe(true);
  });

  it('an out-of-scope tag drops nothing while the filter is disarmed', async () => {
    // Same fixture, `scopeFilter` absent: the tag is recorded by the model and
    // ignored by the engine. Off is the default, and it must be inert.
    const llm = new MockLLMProvider('openai', {
      structured: {
        verdict: 'comment',
        summary: 's',
        score: 50,
        findings: [{ ...fixture.findings[0]!, scope: 'out_of_scope' }],
      },
    });
    const diff = await new MockGitClient().diff();
    const outcome = await reviewPullRequest({
      systemPrompt: 's',
      model: 'm',
      diff,
      llm,
      intent: 'Stated purpose: something else entirely.',
    });
    expect(outcome.review.findings).toHaveLength(1);
    expect(outcome.review.score).toBe(65);
  });

  it('forwards sessionId to every LLM call (OpenRouter session grouping)', async () => {
    const seen: (string | undefined)[] = [];
    const recorder: LLMProvider = {
      id: 'openrouter',
      async completeStructured<T>(req): Promise<StructuredResult<T>> {
        seen.push(req.sessionId);
        return {
          data: fixture as unknown as T,
          model: req.model,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          raw: '',
          attempts: 1,
        };
      },
      async listModels() {
        return [];
      },
      async complete() {
        throw new Error('not used');
      },
      async embed() {
        return [];
      },
    };
    const diff = await new MockGitClient().diff();
    await reviewPullRequest({ systemPrompt: 's', model: 'm', diff, llm: recorder, sessionId: 'sess-abc' });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s === 'sess-abc')).toBe(true);
  });
});

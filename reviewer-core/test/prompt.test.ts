/**
 * assemblePrompt — PR description slot (the fix that was missing: the PR body
 * never reached the prompt). Pins rendering, omit-when-empty, untrusted-wrap,
 * truncation, and ordering (before the diff).
 */
import { describe, it, expect } from 'vitest';
import { assemblePrompt, INJECTION_GUARD, SCOPE_RULE } from '../src/prompt.js';

function userOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  const { messages } = assemblePrompt(parts);
  return messages[1]!.content;
}

function systemOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  return assemblePrompt(parts).messages[0]!.content;
}

describe('assemblePrompt — shared injection guard (server + CI)', () => {
  const sys = systemOf({ system: 'AGENT-SYS', diff: 'DIFF' });

  it('appends the guard to the agent system prompt', () => {
    expect(sys.startsWith('AGENT-SYS')).toBe(true);
    expect(sys).toMatch(/<untrusted>.*DATA to be analyzed/s);
  });

  it('forbids "intentional/test/demo" claims from descoping the review', () => {
    // The defense that replaced the keyword sanitizer: a general, trusted,
    // language-agnostic rule — not text parsing of untrusted input.
    expect(sys).toMatch(/test fixture|intentional|demo/i);
    expect(sys).toMatch(/never reduce|never .*descope|REPORT it/i);
    expect(sys).toMatch(/any language/i);
  });

  it('exports the SAME string it appends, so a second caller cannot fork it', () => {
    // INJECTION_GUARD is exported because the server's Conventions Extractor
    // feeds untrusted repo files to a model WITHOUT going through
    // assemblePrompt, and the invariant is that exactly one such rule exists.
    // An export that drifted from what assemblePrompt uses would silently give
    // that second path a weaker guard — which is the failure this pins.
    expect(sys).toBe(`AGENT-SYS\n\n${INJECTION_GUARD}`);
  });
});

describe('assemblePrompt — ## PR description', () => {
  it('renders the section (untrusted-wrapped) before the diff when present', () => {
    const { messages, assembly } = assemblePrompt({
      system: 'sys',
      diff: 'DIFF',
      prDescription: 'Adds rate limiting to the public /api endpoints.',
    });
    const user = messages[1]!.content;
    expect(user).toContain('## PR description');
    expect(user).toContain('<untrusted source="pr-description">');
    expect(user).toContain('Adds rate limiting to the public /api endpoints.');
    expect(user.indexOf('## PR description')).toBeLessThan(user.indexOf('## Diff to review'));
    expect(assembly.pr_description).toContain('Adds rate limiting');
  });

  it('omits the section when prDescription is undefined or blank (no behaviour change)', () => {
    expect(userOf({ system: 'sys', diff: 'DIFF' })).not.toContain('## PR description');
    expect(assemblePrompt({ system: 'sys', diff: 'DIFF' }).assembly.pr_description ?? null).toBeNull();
    expect(userOf({ system: 'sys', diff: 'DIFF', prDescription: '   ' })).not.toContain(
      '## PR description',
    );
  });

  it('truncates a huge body to the 4k cap', () => {
    const { assembly } = assemblePrompt({
      system: 'sys',
      diff: 'D',
      prDescription: 'x'.repeat(10_000),
    });
    expect((assembly.pr_description as string).length).toBe(4000);
  });
});

describe('assemblePrompt — ## PR intent (derived) + SCOPE_RULE (L03)', () => {
  const INTENT = 'Stated purpose: add rate limiting.\n\nIn scope:\n- rate limiting';

  it('with NO intent, the prompt is byte-identical to the pre-L03 one', () => {
    // The omit-when-empty contract every other slot honours, and the thing that
    // makes this feature safe to ship: an agent that never derives an intent
    // gets exactly the prompt it got before.
    const sys = systemOf({ system: 'AGENT-SYS', diff: 'DIFF' });
    expect(sys).toBe(`AGENT-SYS\n\n${INJECTION_GUARD}`);
    expect(sys).not.toContain(SCOPE_RULE);

    const { assembly, messages } = assemblePrompt({ system: 'AGENT-SYS', diff: 'DIFF' });
    expect(messages[1]!.content).not.toContain('## PR intent');
    expect(assembly.intent ?? null).toBeNull();

    // Blank and whitespace-only are the same as absent.
    expect(systemOf({ system: 'AGENT-SYS', diff: 'D', intent: '  ' })).toBe(
      `AGENT-SYS\n\n${INJECTION_GUARD}`,
    );
  });

  it('renders the block untrusted-wrapped, after the description and before the diff', () => {
    const { messages, assembly } = assemblePrompt({
      system: 'sys',
      diff: 'DIFF',
      prDescription: 'Adds rate limiting.',
      intent: INTENT,
    });
    const user = messages[1]!.content;
    expect(user).toContain('## PR intent (derived)');
    expect(user).toContain('<untrusted source="derived-intent">');
    expect(user).toContain('add rate limiting');
    expect(user.indexOf('## PR description')).toBeLessThan(user.indexOf('## PR intent'));
    expect(user.indexOf('## PR intent')).toBeLessThan(user.indexOf('## Diff to review'));
    expect(assembly.intent).toBe(INTENT);
  });

  it('puts SCOPE_RULE BEFORE the guard, leaving the guard last', () => {
    // Ordering is the assertion, not the presence: the guard has to be the final
    // instruction the model reads, and SCOPE_RULE asks it to tag findings — a
    // rule that landed after the guard would read as qualifying it.
    const sys = systemOf({ system: 'AGENT-SYS', diff: 'D', intent: INTENT });
    expect(sys).toBe(`AGENT-SYS\n\n${SCOPE_RULE}\n\n${INJECTION_GUARD}`);
    expect(sys.indexOf(SCOPE_RULE)).toBeLessThan(sys.indexOf(INJECTION_GUARD));
    expect(sys.endsWith(INJECTION_GUARD)).toBe(true);
  });

  it('SCOPE_RULE asks for a TAG and never for suppression', () => {
    // The gate decides what a reader sees; the model is only asked to label.
    // A rule that told the model to withhold findings would contradict the
    // guard directly.
    expect(SCOPE_RULE).toMatch(/in_scope/);
    expect(SCOPE_RULE).toMatch(/out_of_scope/);
    expect(SCOPE_RULE).toMatch(/Tagging is NOT filtering/i);
    expect(SCOPE_RULE).toMatch(/ALWAYS reported/i);
  });
});

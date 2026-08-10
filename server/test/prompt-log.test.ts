import { describe, it, expect } from 'vitest';
import type { PromptSection } from '@devdigest/reviewer-core';
import {
  buildPromptRecord,
  logPromptAssembly,
  newCorrelationId,
  redactUrlForLog,
} from '../src/platform/prompt-log.js';
import { RunLogger } from '../src/platform/run-logger.js';
import type { RunBus } from '../src/platform/sse.js';

/**
 * The one property worth a test here: **the log describes the prompt and never
 * reproduces it.**
 *
 * Everything else in this module is arithmetic. This is the part that, if it
 * regresses, quietly writes a customer's diff, a private spec chunk or a
 * committed secret into stdout — where it lands in a file and in whatever ships
 * logs off the box, with none of the workspace scoping `run_traces` has.
 *
 * So the assertions are phrased as absence: given sections whose content is
 * distinctive, no distinctive string may appear in anything either sink
 * received.
 */

const SECRET = 'sk_live_51ABCDEFhunter2';
const DIFF_BODY = '+  const apiKey = process.env.STRIPE_SECRET;';
const SPEC_BODY = 'Internal only: the Q3 pricing model is 4.2% per seat.';

const SECTIONS: PromptSection[] = [
  { name: 'system', trust: 'trusted', source: 'agent system prompt + guards', text: 'You are a reviewer.' },
  { name: 'pr-description', trust: 'untrusted', source: 'pr-description', text: `Rotate ${SECRET}` },
  { name: 'specs', trust: 'untrusted', source: '1 spec chunk(s)', text: SPEC_BODY },
  { name: 'diff', trust: 'untrusted', source: 'diff', text: `${DIFF_BODY}\n+  more\n` },
];

/** Counts characters, so `chars` is exact and `tokens` is a stable stand-in. */
const TOKENIZER = { count: (s: string) => Math.ceil(s.length / 4) };

/** Captures both sinks a `RunLogger` can write to. */
function capture() {
  const bus: string[] = [];
  const stdout: { msg: string; obj: unknown }[] = [];
  const fakeBus = {
    publish: (_runId: string, _kind: string, msg: string) => bus.push(msg),
  } as unknown as RunBus;
  const pino = {
    info: (obj: unknown, msg?: string) => stdout.push({ msg: msg ?? '', obj }),
    warn: (obj: unknown, msg?: string) => stdout.push({ msg: msg ?? '', obj }),
    error: (obj: unknown, msg?: string) => stdout.push({ msg: msg ?? '', obj }),
    debug: (obj: unknown, msg?: string) => stdout.push({ msg: msg ?? '', obj }),
  };
  return { bus, stdout, logger: new RunLogger(fakeBus, ['run-1'], pino, { prId: 'pr-1' }) };
}

describe('prompt logging never reproduces the prompt', () => {
  it('emits sizes and names, and no section content, in either sink', () => {
    const { bus, stdout, logger } = capture();
    const record = buildPromptRecord(SECTIONS, TOKENIZER, false);
    logPromptAssembly(logger, record, {
      correlationId: 'c0ffee01',
      stage: 'review',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      runId: 'run-1',
      agent: 'General Reviewer',
    }, false);

    const everything = JSON.stringify({ bus, stdout });
    for (const leak of [SECRET, DIFF_BODY, SPEC_BODY, 'You are a reviewer.']) {
      expect(everything).not.toContain(leak);
    }
    // …while still being useful: names, sizes, model and the correlation id.
    expect(everything).toContain('pr-description');
    expect(everything).toContain('c0ffee01');
    expect(everything).toContain('deepseek/deepseek-v4-flash');
  });

  it('puts one human line on the run stream and the structured record on stdout only', () => {
    const { bus, stdout, logger } = capture();
    logPromptAssembly(logger, buildPromptRecord(SECTIONS, TOKENIZER, false), {
      correlationId: 'c0ffee02', stage: 'review', provider: 'openai', model: 'gpt-x',
    }, false);

    // The Live Log (and therefore the persisted trace) gets exactly one line.
    expect(bus).toHaveLength(1);
    expect(bus[0]).toContain('Prompt assembled [c0ffee02]');
    expect(bus[0]).toContain('4 section(s)');

    // The machine record is stdout-only — it must NOT be on the bus.
    const structured = stdout.find((l) => l.msg === 'prompt.assembled');
    expect(structured).toBeDefined();
    expect(bus.join(' ')).not.toContain('prompt.assembled');
  });

  it('adds a digest only in verbose mode, and the digest is not the content', () => {
    const plain = buildPromptRecord(SECTIONS, TOKENIZER, false);
    const verbose = buildPromptRecord(SECTIONS, TOKENIZER, true);

    expect(plain.every((r) => r.digest === undefined)).toBe(true);
    expect(verbose.every((r) => typeof r.digest === 'string' && r.digest.length === 12)).toBe(true);
    // A digest distinguishes two runs without revealing either.
    expect(JSON.stringify(verbose)).not.toContain(SECRET);
    // Same bytes → same digest; changed bytes → different. That is the whole use.
    const again = buildPromptRecord(SECTIONS, TOKENIZER, true);
    expect(again[3]!.digest).toBe(verbose[3]!.digest);
    const changed = buildPromptRecord(
      [{ ...SECTIONS[3]!, text: SECTIONS[3]!.text + 'x' }],
      TOKENIZER,
      true,
    );
    expect(changed[0]!.digest).not.toBe(verbose[3]!.digest);
  });

  it('records order, trust and both size units per section', () => {
    const record = buildPromptRecord(SECTIONS, TOKENIZER, false);
    expect(record.map((r) => r.i)).toEqual([0, 1, 2, 3]);
    expect(record.map((r) => r.trust)).toEqual(['trusted', 'untrusted', 'untrusted', 'untrusted']);
    expect(record[3]!.chars).toBe(SECTIONS[3]!.text.length);
    expect(record[3]!.tokens).toBe(Math.ceil(SECTIONS[3]!.text.length / 4));
  });

  it('gives a short, unique correlation id', () => {
    const a = newCorrelationId();
    expect(a).toHaveLength(8);
    expect(a).not.toBe(newCorrelationId());
  });
});

/**
 * A URL in a PR body may carry the author's own credential in its query string —
 * `?token=`, `?sig=`, a pre-signed S3 URL. The card shows it (workspace-scoped,
 * and showing an author which of their links failed is the point); a log line
 * must not (stdout goes to a file and off the box).
 */
describe('redactUrlForLog', () => {
  it('drops the query and fragment, keeps origin and path', () => {
    expect(redactUrlForLog('https://wiki.internal/spec?token=abc123&u=me')).toBe(
      'https://wiki.internal/spec (query redacted)',
    );
    expect(redactUrlForLog('https://s3.example.com/p/f.md#L4')).toBe(
      'https://s3.example.com/p/f.md (query redacted)',
    );
    expect(redactUrlForLog('https://claude.com/claude-code')).toBe('https://claude.com/claude-code');
  });

  it('leaves non-URL refs alone — paths, issue numbers, counts', () => {
    for (const ref of ['docs/plans/x.md', '#301', '14 file(s), 31 hunk header(s)', 'PR description']) {
      expect(redactUrlForLog(ref)).toBe(ref);
    }
  });

  it('never returns anything containing a token it was given', () => {
    const out = redactUrlForLog('https://h.test/a?X-Amz-Signature=DEADBEEFSECRET');
    expect(out).not.toContain('DEADBEEFSECRET');
  });
});

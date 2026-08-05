import { describe, it, expect } from 'vitest';
import {
  normalisePath,
  normaliseRule,
  verifyCandidates,
  type ProposedCandidate,
} from '../src/modules/conventions/pipeline/verify.js';
import type { SampledFile } from '../src/modules/conventions/pipeline/samples.js';
import { MAX_EVIDENCE_SPAN } from '../src/modules/conventions/constants.js';

/**
 * The step the feature's credibility rests on: a candidate that cannot point at
 * real code is dropped, exactly as a finding that cannot cite a real diff line
 * is dropped.
 *
 * The single most important assertion in this file is `keeps the snippet READ
 * FROM THE SAMPLE, not one supplied by the model` — everything else is a way of
 * getting a bad citation thrown out, but that one is why a good citation can be
 * trusted.
 */

const FILE_LINES = [
  'import { db } from "../lib/db";', // 1
  '', // 2
  'export async function getUser(id: string) {', // 3
  '  const user = await db.users.find(id);', // 4
  '  return user;', // 5
  '}', // 6
  '', // 7
  '', // 8
];

function sample(over: Partial<SampledFile> = {}): Map<string, SampledFile> {
  return new Map([
    [
      'src/api/users.ts',
      {
        path: 'src/api/users.ts',
        lines: FILE_LINES,
        shownUpTo: 6,
        totalLines: FILE_LINES.length,
        ...over,
      },
    ],
  ]);
}

function candidate(over: Partial<ProposedCandidate> = {}): ProposedCandidate {
  return {
    category: 'error-handling',
    rule: 'Database access goes through the db singleton',
    evidence_path: 'src/api/users.ts',
    evidence_start_line: 3,
    evidence_end_line: 6,
    confidence: 0.9,
    ...over,
  };
}

describe('verifyCandidates — what survives', () => {
  it('keeps the snippet READ FROM THE SAMPLE, not one supplied by the model', () => {
    // The model has no snippet field at all, so this is what makes a fabricated
    // snippet unrepresentable rather than merely unlikely — and what makes the
    // text on screen match the GitHub permalink byte for byte.
    const { kept, dropped } = verifyCandidates([candidate()], sample());
    expect(dropped).toEqual([]);
    expect(kept[0]!.evidence_snippet).toBe(
      [
        'export async function getUser(id: string) {',
        '  const user = await db.users.find(id);',
        '  return user;',
        '}',
      ].join('\n'),
    );
  });

  it('trims blank edges so a citation one line off still starts at the code', () => {
    const { kept } = verifyCandidates([candidate({ evidence_start_line: 2 })], sample());
    expect(kept[0]!.evidence_snippet.startsWith('export async function')).toBe(true);
  });

  it('keeps a comment-only span — a JSDoc rule has no other evidence', () => {
    const docs = new Map<string, SampledFile>([
      [
        'a.ts',
        { path: 'a.ts', lines: ['/**', ' * Adds two numbers.', ' */'], shownUpTo: 3, totalLines: 3 },
      ],
    ]);
    const { kept } = verifyCandidates(
      [candidate({ evidence_path: 'a.ts', evidence_start_line: 1, evidence_end_line: 3 })],
      docs,
    );
    expect(kept).toHaveLength(1);
  });

  it('clamps an over-long span instead of dropping it, and reports the clamp', () => {
    // A sprawling citation is badly framed, not false; its first lines are still
    // the evidence. The stored end line has to match the snippet, or the GitHub
    // link would highlight more than the snippet shows.
    const long = new Map<string, SampledFile>([
      [
        'a.ts',
        {
          path: 'a.ts',
          lines: Array.from({ length: 60 }, (_, i) => `line ${i + 1}`),
          shownUpTo: 60,
          totalLines: 60,
        },
      ],
    ]);
    const { kept } = verifyCandidates(
      [candidate({ evidence_path: 'a.ts', evidence_start_line: 1, evidence_end_line: 60 })],
      long,
    );
    expect(kept[0]!.evidence_end_line).toBe(MAX_EVIDENCE_SPAN);
    expect(kept[0]!.evidence_snippet.split('\n')).toHaveLength(MAX_EVIDENCE_SPAN);
  });
});

describe('verifyCandidates — one case per drop reason', () => {
  it('file_not_sampled: the model named a file it was never shown', () => {
    const { kept, dropped } = verifyCandidates(
      [candidate({ evidence_path: 'src/does/not/exist.ts' })],
      sample(),
    );
    expect(kept).toEqual([]);
    expect(dropped).toEqual([{ rule: candidate().rule, reason: 'file_not_sampled' }]);
  });

  it('line_out_of_range: a line beyond what the prompt actually carried', () => {
    // The file HAS 8 lines; the prompt showed 6. Citing line 8 is a guess about
    // text the model never received, however real that line is.
    const { kept, dropped } = verifyCandidates(
      [candidate({ evidence_start_line: 7, evidence_end_line: 8 })],
      sample(),
    );
    expect(kept).toEqual([]);
    expect(dropped[0]!.reason).toBe('line_out_of_range');
  });

  it('line_out_of_range: zero, negative, fractional and inverted spans', () => {
    const bad: ProposedCandidate[] = [
      candidate({ rule: 'a', evidence_start_line: 0 }),
      candidate({ rule: 'b', evidence_start_line: -3 }),
      candidate({ rule: 'c', evidence_start_line: 1.5 }),
      candidate({ rule: 'd', evidence_start_line: 5, evidence_end_line: 3 }),
    ];
    const { kept, dropped } = verifyCandidates(bad, sample());
    expect(kept).toEqual([]);
    expect(dropped.map((d) => d.reason)).toEqual(Array(4).fill('line_out_of_range'));
  });

  it('empty_snippet: the whole cited span is blank', () => {
    const blank = new Map<string, SampledFile>([
      ['a.ts', { path: 'a.ts', lines: ['', '  ', ''], shownUpTo: 3, totalLines: 3 }],
    ]);
    const { kept, dropped } = verifyCandidates(
      [candidate({ evidence_path: 'a.ts', evidence_start_line: 1, evidence_end_line: 3 })],
      blank,
    );
    expect(kept).toEqual([]);
    expect(dropped[0]!.reason).toBe('empty_snippet');
  });

  it('duplicate_rule: the same rule reworded keeps the first, drops the rest', () => {
    const { kept, dropped } = verifyCandidates(
      [
        candidate({ rule: 'Use `async/await` instead of .then() chains' }),
        candidate({ rule: 'use async await, instead of .then() chains!' }),
      ],
      sample(),
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]!.rule).toBe('Use `async/await` instead of .then() chains');
    expect(dropped[0]!.reason).toBe('duplicate_rule');
  });

  it('a rejected candidate never contributes a rule that blocks a later one', () => {
    // Dedupe is seeded only by SURVIVORS. If a dropped candidate reserved its
    // rule, one bad citation would suppress the good citation of the same rule.
    const { kept } = verifyCandidates(
      [
        candidate({ evidence_path: 'ghost.ts' }),
        candidate({ evidence_start_line: 3, evidence_end_line: 5 }),
      ],
      sample(),
    );
    expect(kept).toHaveLength(1);
  });

  it('reports every casualty, so proposed - kept is never silent', () => {
    const { kept, dropped } = verifyCandidates(
      [
        candidate({ rule: 'good one' }),
        candidate({ rule: 'ghost', evidence_path: 'nope.ts' }),
        candidate({ rule: 'oob', evidence_start_line: 99 }),
      ],
      sample(),
    );
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(2);
  });
});

describe('normalisePath', () => {
  it('forgives the two path shapes a model reliably invents', () => {
    // Both can only ever resolve ONTO a path that was sampled, so leniency here
    // cannot admit a file the model never saw.
    expect(normalisePath('./src/api/users.ts')).toBe('src/api/users.ts');
    expect(normalisePath('src/api/users.ts:23')).toBe('src/api/users.ts');
    expect(normalisePath(' src/api/users.ts:23-31 ')).toBe('src/api/users.ts');
  });

  it('resolves a decorated path onto the sampled file', () => {
    const { kept } = verifyCandidates(
      [candidate({ evidence_path: './src/api/users.ts:3-6' })],
      sample(),
    );
    expect(kept).toHaveLength(1);
  });

  it('leaves a genuinely different path different', () => {
    expect(normalisePath('src/api/users.test.ts')).toBe('src/api/users.test.ts');
  });
});

describe('normaliseRule', () => {
  it('collapses the ways one rule gets reworded', () => {
    expect(normaliseRule('Use `Result<T, E>`  for errors.')).toBe(
      normaliseRule('use Result<T, E> for errors'),
    );
  });

  it('keeps genuinely different rules apart', () => {
    expect(normaliseRule('Routes return Result')).not.toBe(normaliseRule('Routes throw ApiError'));
  });
});

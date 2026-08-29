/**
 * NFR-1 — the scorer module has no import of the filesystem, the network, a
 * database or `process.env`. The threshold in the spec is "zero such imports in
 * a static check of the module's import graph", and the graph as built is
 * stronger than that: `src/eval/score.ts` imports one thing, `import type
 * { Finding, FindingKind }`, which erases at compile time. **The RUNTIME import
 * graph is empty** — there is no edge to follow, safe or otherwise.
 *
 * This file is the static half of the proof. The behavioural half (AC-13: a
 * batch scored while every provider method and `fetch` throws) lives in
 * `eval-score.test.ts`, because a static check cannot see a call made through a
 * global and a runtime check cannot see an import that was never used.
 *
 * The test reads the source text rather than the module graph on purpose: an
 * `import type` is invisible at runtime, so `import()`-based introspection would
 * report "no imports" whether or not someone added `import fs from 'node:fs'`
 * next to it — a check that cannot fail.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { scoreEvalBatch, scoreEvalCase, type EvalCaseResult } from '../src/index.js';

const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));
const ENTRY = 'eval/score.ts';

interface ModuleImports {
  /** Specifiers that survive compilation and are evaluated at runtime. */
  runtime: string[];
  /** `import type` / `export type` specifiers — erased, and therefore harmless. */
  typeOnly: string[];
}

/**
 * A deliberately literal reader of a module's `import` / `export … from`
 * statements. It is not a TypeScript parser and does not need to be: anything it
 * fails to classify as type-only is reported as a runtime edge, so the failure
 * direction is "shouts about something safe", never "stays quiet about
 * something dangerous".
 */
function readImports(relPath: string): ModuleImports {
  const source = readFileSync(path.join(SRC_DIR, relPath), 'utf8');
  const runtime: string[] = [];
  const typeOnly: string[] = [];

  const statement = /(?:^|\n)\s*(?:import|export)\b([\s\S]*?)from\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(statement)) {
    const clause = match[1] ?? '';
    const specifier = match[2] ?? '';
    // `import type X from 'y'` and `import { type A, type B } from 'y'` both
    // erase; a clause mixing a value binding in does not, and lands in `runtime`.
    const allBindingsTyped =
      /^\s*type\s/.test(clause) ||
      (/\{/.test(clause) &&
        clause
          .replace(/[\s\S]*\{/, '')
          .replace(/\}[\s\S]*/, '')
          .split(',')
          .filter((b) => b.trim().length > 0)
          .every((b) => /^\s*type\s/.test(b)));
    (allBindingsTyped ? typeOnly : runtime).push(specifier);
  }

  // A bare side-effect import (`import 'foo';`) has no `from` and is missed by the
  // pattern above, so look for it separately — it is the most side-effectful
  // import shape there is.
  for (const match of source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) {
    runtime.push(match[1] ?? '');
  }

  return { runtime, typeOnly };
}

/**
 * Remove line and block comments. Crude by design — it is only ever pointed at
 * this one small module, and over-removal cannot hide a violation, because what
 * it removes is text that could not execute.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('NFR-1 — the scorer imports nothing at runtime', () => {
  it('the entry module has an EMPTY runtime import graph, and one erased type import', () => {
    const { runtime, typeOnly } = readImports(ENTRY);

    // Value equality, not a "does not contain node:fs" check: an allowlist that
    // only forbids known-bad names passes the moment someone imports something
    // nobody thought to forbid.
    expect(runtime).toEqual([]);
    expect(typeOnly).toEqual(['@devdigest/shared']);
  });

  it('names the forbidden capabilities explicitly, so the failure message says which one', () => {
    // Redundant with the emptiness assertion above by construction, and kept
    // because it is the assertion that reads as the requirement: a reviewer
    // seeing this go red knows immediately which capability ring 0 grew.
    //
    // Comments are stripped first, and that is not a convenience: `score.ts`'s
    // own docstring contains the words `process.env` while promising never to
    // touch it, so a raw substring scan would fail on the promise itself.
    const code = stripComments(readFileSync(path.join(SRC_DIR, ENTRY), 'utf8'));
    const { runtime, typeOnly } = readImports(ENTRY);

    const forbiddenSpecifiers = [
      'node:fs', 'node:net', 'node:http', 'node:https', 'node:child_process',
      'node:crypto', 'node:os', 'node:path', 'node:dgram', 'node:worker_threads',
      'fs', 'fs/promises', 'path', 'crypto', 'os', 'child_process',
      'postgres', 'drizzle-orm', 'openai', 'simple-git', 'octokit', 'fastify',
    ];
    const offending = [...runtime, ...typeOnly].filter((specifier) =>
      forbiddenSpecifiers.some((f) => specifier === f || specifier.startsWith(`${f}/`)),
    );
    expect(offending).toEqual([]);

    // The capabilities that need no import at all.
    expect(code).not.toMatch(/process\s*\.\s*env/);
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/\brequire\s*\(/);
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(code).not.toMatch(/\bDate\.now\b|new\s+Date\b|Math\.random\b/);
  });

  it('nothing reachable from the scorer can perform I/O, because nothing is reachable', () => {
    // The transitive walk exists so that adding a relative import — the natural
    // way this module would acquire a dependency — is caught here rather than by
    // the entry-module assertion alone. The expected closure is empty.
    const seen = new Set<string>();
    const queue = [ENTRY];
    const reached: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      const { runtime } = readImports(current);
      for (const specifier of runtime) {
        reached.push(`${current} → ${specifier}`);
        if (specifier.startsWith('.')) {
          queue.push(path.normalize(path.join(path.dirname(current), specifier.replace(/\.js$/, '.ts'))));
        }
      }
    }

    expect(reached).toEqual([]);
  });
});

describe('NFR-1 / AC-14 — the signature makes a model call unrepresentable', () => {
  it('neither exported function takes a provider (or any second) parameter', () => {
    // AC-13 is proved structurally as well as behaviourally: there is no
    // parameter an `LLMProvider` could arrive through, so "the scorer made no
    // model call" is not a promise anyone has to keep.
    expect(scoreEvalCase.length).toBe(1);
    expect(scoreEvalBatch.length).toBe(1);
  });

  it('holds no hidden state and does not mutate its arguments', () => {
    // AC-14 from the other side: identical output across calls could also come
    // from a cache, and a scorer that mutated `expected` in place (marking
    // consumed expectations, say) would produce a DIFFERENT second answer for a
    // caller that reused the array. Both are pinned here.
    const cases: EvalCaseResult[] = [
      {
        expectation: 'must_find',
        expected: [
          { file: 'src/a.ts', start_line: 10, end_line: 11 },
          { file: 'src/a.ts', start_line: 20, end_line: 21 },
        ],
        actual: [
          {
            id: 'f1',
            severity: 'CRITICAL',
            category: 'security',
            title: 'leak',
            file: 'src/a.ts',
            start_line: 10,
            end_line: 10,
            rationale: 'because',
            confidence: 0.9,
            kind: 'finding',
          },
        ],
        dropped: 2,
      },
    ];
    const argumentsBefore = structuredClone(cases);

    const first = scoreEvalBatch(cases);
    const second = scoreEvalBatch(cases);

    expect(second).toEqual(first);
    expect(cases).toEqual(argumentsBefore);
  });
});

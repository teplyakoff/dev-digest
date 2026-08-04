import { describe, it, expect } from 'vitest';
import {
  buildSampleBlock,
  pickConfigFiles,
  reducePackageJson,
  renderFile,
} from '../src/modules/conventions/pipeline/samples.js';
import {
  CONFIG_FAMILIES,
  MAX_SAMPLE_LINES,
  MAX_TOTAL_BYTES,
} from '../src/modules/conventions/constants.js';

/**
 * Sampling is the code-only half of the extractor: no model runs in this file.
 *
 * What is being pinned is the pair of properties the verifier depends on — the
 * prompt states which lines it is showing, and `SampledFile.shownUpTo` says the
 * same thing in a form code can check. If those two ever disagree, a truthful
 * citation gets dropped as out-of-range, or a hallucinated one gets kept.
 */

const lines = (n: number, prefix = 'line') =>
  Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n');

describe('pickConfigFiles', () => {
  it('takes one file per family, in family order', () => {
    const present = new Set(['tsconfig.json', '.editorconfig', 'eslint.config.js', 'package.json']);
    expect(pickConfigFiles(CONFIG_FAMILIES, present)).toEqual([
      'eslint.config.js',
      'tsconfig.json',
      '.editorconfig',
      'package.json',
    ]);
  });

  it('picks the first present member when a repo is mid-migration', () => {
    // Both configs exist. Showing the model both invites "this project uses two
    // lint configs", which is a fact about the migration, not a house rule.
    const present = new Set(['eslint.config.js', '.eslintrc.json']);
    expect(pickConfigFiles(CONFIG_FAMILIES, present)).toEqual(['eslint.config.js']);
  });

  it('returns nothing for a repo with no config at all', () => {
    expect(pickConfigFiles(CONFIG_FAMILIES, new Set())).toEqual([]);
  });
});

describe('reducePackageJson', () => {
  it('keeps only the keys that say how the team works', () => {
    const raw = JSON.stringify({
      name: 'x',
      version: '1.0.0',
      scripts: { test: 'vitest' },
      dependencies: { zod: '^3' },
      devDependencies: { vitest: '^2' },
      // A resolved tree can be tens of kB and says nothing about conventions.
      packageManager: 'pnpm@11',
    });
    const out = JSON.parse(reducePackageJson(raw)!);
    expect(Object.keys(out)).toEqual(['scripts', 'dependencies', 'devDependencies']);
  });

  it('omits keys the file does not have rather than emitting empties', () => {
    const out = JSON.parse(reducePackageJson('{"scripts":{"dev":"tsx"}}')!);
    expect(out).toEqual({ scripts: { dev: 'tsx' } });
  });

  it('returns null for unparseable or non-object JSON, costing one sample', () => {
    expect(reducePackageJson('{ not json')).toBeNull();
    expect(reducePackageJson('[1,2,3]')).toBeNull();
    expect(reducePackageJson('null')).toBeNull();
  });
});

describe('renderFile', () => {
  it('numbers lines from 1 so a citation can be checked at all', () => {
    const { text } = renderFile({ path: 'a.ts', content: 'const a = 1;\nconst b = 2;' });
    expect(text).toBe('--- a.ts (2 lines) ---\n1| const a = 1;\n2| const b = 2;');
  });

  it('right-aligns the gutter so the code column stays straight', () => {
    const { text } = renderFile({ path: 'a.ts', content: lines(10) });
    expect(text).toContain('\n 1| line 1');
    expect(text).toContain('\n10| line 10');
  });

  it('truncates at the line cap and SAYS SO in the header', () => {
    const { text, sampled } = renderFile({ path: 'big.ts', content: lines(412) });
    // The notice is what stops the model citing line 300 of a file it was shown
    // 180 lines of.
    expect(text).toContain(`--- big.ts (lines 1-${MAX_SAMPLE_LINES} of 412, truncated) ---`);
    expect(sampled.shownUpTo).toBe(MAX_SAMPLE_LINES);
    expect(sampled.totalLines).toBe(412);
    expect(text).toContain('| line 180');
    expect(text).not.toContain('| line 181');
  });

  it('truncates at the byte cap when lines are long', () => {
    const fat = Array.from({ length: 50 }, () => 'x'.repeat(500)).join('\n');
    const { sampled } = renderFile({ path: 'fat.ts', content: fat, maxBytes: 2_000 });
    expect(sampled.shownUpTo).toBeLessThan(50);
    expect(sampled.shownUpTo).toBeGreaterThan(0);
  });

  it('always shows at least one line, however long that line is', () => {
    // Otherwise a minified file would render as a header with no body, and the
    // header would claim to be showing lines 1-0.
    const { sampled } = renderFile({ path: 'min.js', content: 'y'.repeat(50_000), maxBytes: 100 });
    expect(sampled.shownUpTo).toBe(1);
  });

  it('counts lines the way an editor does, on either line ending', () => {
    // An off-by-one here only ever bites on the last line of a file — where it
    // turns a truthful citation into `line_out_of_range`.
    expect(renderFile({ path: 'a.ts', content: 'a\nb\n' }).sampled.totalLines).toBe(2);
    expect(renderFile({ path: 'a.ts', content: 'a\r\nb\r\n' }).sampled.totalLines).toBe(2);
    expect(renderFile({ path: 'a.ts', content: 'a\nb' }).sampled.totalLines).toBe(2);
  });

  it('strips CR from the stored lines, so a snippet is not full of \\r', () => {
    const { sampled } = renderFile({ path: 'a.ts', content: 'const a = 1;\r\n' });
    expect(sampled.lines[0]).toBe('const a = 1;');
  });
});

describe('buildSampleBlock', () => {
  it('records every included file under its own path', () => {
    const block = buildSampleBlock([
      { path: 'tsconfig.json', content: '{}' },
      { path: 'src/a.ts', content: 'const a = 1;' },
    ]);
    expect([...block.sampled.keys()]).toEqual(['tsconfig.json', 'src/a.ts']);
    expect(block.skipped).toEqual([]);
    expect(block.text).toContain('--- tsconfig.json');
    expect(block.text).toContain('--- src/a.ts');
  });

  it('stops adding files at the total budget instead of shrinking one', () => {
    // A file cut to "whatever bytes are left" is the one case where the
    // truncation notice stops being honest, because the cut has nothing to do
    // with that file's own cap.
    // Size the fixture off the constant rather than guessing a file count, so
    // the test keeps testing the budget if MAX_TOTAL_BYTES ever moves.
    const body = lines(MAX_SAMPLE_LINES);
    const perFile = Buffer.byteLength(body, 'utf8');
    const count = Math.ceil((MAX_TOTAL_BYTES / perFile) * 2);
    const inputs = Array.from({ length: count }, (_, i) => ({
      path: `f${i}.ts`,
      content: body,
      maxBytes: MAX_TOTAL_BYTES,
    }));
    const block = buildSampleBlock(inputs);
    expect(block.skipped.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(block.text, 'utf8')).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
    for (const path of block.skipped) expect(block.sampled.has(path)).toBe(false);
  });

  it('refuses everything after the first refusal, so rank decides the set', () => {
    // A later, smaller file sneaking in would make membership depend on file
    // size rather than on rank order.
    const huge = 'z'.repeat(MAX_TOTAL_BYTES);
    const block = buildSampleBlock([
      { path: 'first.ts', content: huge, maxBytes: MAX_TOTAL_BYTES },
      { path: 'second.ts', content: huge, maxBytes: MAX_TOTAL_BYTES },
      { path: 'tiny.ts', content: 'const a = 1;' },
    ]);
    expect(block.skipped).toEqual(['second.ts', 'tiny.ts']);
  });

  it('always includes the first file, even when it alone exceeds the budget', () => {
    const block = buildSampleBlock([
      { path: 'only.ts', content: 'z'.repeat(MAX_TOTAL_BYTES * 2), maxBytes: MAX_TOTAL_BYTES * 2 },
    ]);
    expect(block.sampled.has('only.ts')).toBe(true);
  });
});

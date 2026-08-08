import { describe, it, expect } from 'vitest';
import type { SmartDiffRole } from '@devdigest/shared';
import { classifyPath } from '../src/modules/smart-diff/classify.js';
import {
  BOILERPLATE_PATTERNS,
  WIRING_PATTERNS,
} from '../src/modules/smart-diff/constants.js';

/**
 * `classifyPath` — the whole "smart" part of Smart Diff, and a pure function
 * over a string.
 *
 * No app, no container, no Docker: ring 0 gets called directly
 * (`.claude/skills/onion-architecture/SKILL.md` §12). Model:
 * `pulls-helpers.test.ts`.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT TEST: ordering of files. `classifyPath`
 * receives one path and knows nothing about the other files in the PR, so an
 * ordering assertion here would only be pinning this file's own fixture array.
 * The comparator lives in `smart-diff-service.test.ts`.
 *
 * Each `it()` below names the DECISION it guards, because most of these are
 * product calls ("is a README boilerplate?") that a future pattern edit can
 * reverse while everything still compiles.
 */

/** Assert a whole fixture list lands in one role, naming the path that didn't. */
function expectAll(paths: readonly string[], role: SmartDiffRole): void {
  for (const path of paths) {
    // Compared as a pair so a failure reads `['x.ts','core'] to equal
    // ['x.ts','wiring']` rather than `'core' to be 'wiring'` with no path.
    expect([path, classifyPath(path)]).toEqual([path, role]);
  }
}

describe('classifyPath — boilerplate', () => {
  // Assertions 1 + 12, in ONE test on purpose. They are a single decision seen
  // from two sides: any rule loose enough to be written `includes('package.json')`
  // claims the lock-file too, and "a lock-file is always boilerplate" is a named
  // acceptance criterion of this feature. Split across two tests, one of them
  // stays green while the feature is broken.
  it('separates package-lock.json (boilerplate) from package.json (wiring)', () => {
    expect(classifyPath('package-lock.json')).toBe('boilerplate');
    expect(classifyPath('package.json')).toBe('wiring');
    // Same pair one directory down — the monorepo shape this repo actually has.
    expect(classifyPath('client/package-lock.json')).toBe('boilerplate');
    expect(classifyPath('client/package.json')).toBe('wiring');
  });

  // `pnpm-lock.yaml` does not end in `.lock`, so it rides on an exact-basename
  // rule. A later "any *.yaml is config → wiring" pattern would steal it.
  it('keeps pnpm-lock.yaml in boilerplate despite the .yaml extension', () => {
    expect(classifyPath('pnpm-lock.yaml')).toBe('boilerplate');
    expect(classifyPath('server/pnpm-lock.yaml')).toBe('boilerplate');
  });

  // The rule is `*.lock`, not a list of JavaScript filenames: this classifier
  // runs on imported PRs from arbitrary repos.
  it('treats every ecosystem’s lock-file as boilerplate, not just the JS ones', () => {
    expectAll(['yarn.lock', 'Cargo.lock', 'Gemfile.lock', 'poetry.lock'], 'boilerplate');
  });

  it('treats build output and tool caches as boilerplate', () => {
    expectAll(
      ['dist/index.js', 'build/main.css', '.next/static/chunk.js', 'coverage/lcov.info'],
      'boilerplate',
    );
  });

  // A pattern anchored to the START of the path passes the case above and fails
  // this one — and every repo this feature is interesting on is a monorepo.
  it('finds build output at any depth, not only at the repo root', () => {
    expect(classifyPath('server/dist/index.js')).toBe('boilerplate');
    expect(classifyPath('packages/web/.next/static/chunk.js')).toBe('boilerplate');
  });

  it('treats snapshot fixtures as boilerplate', () => {
    expect(classifyPath('src/__snapshots__/Panel.test.tsx.snap')).toBe('boilerplate');
  });

  // Load-bearing: a `.ts` file under `src/` that a naive "source file = core"
  // rule would sort to the TOP of the review. It is a generated copy that this
  // repo forbids editing (`client/src/vendor/shared/**`).
  it('treats a vendored copy as boilerplate even though it is .ts under src/', () => {
    expect(classifyPath('client/src/vendor/shared/contracts/brief.ts')).toBe('boilerplate');
  });

  it('treats minified bundles and source maps as boilerplate', () => {
    expectAll(['app.min.js', 'bundle.js.map'], 'boilerplate');
  });
});

describe('classifyPath — wiring', () => {
  // The decision this feature is most likely to have silently reverted:
  // `boilerplate` means "generated — skim", and hand-written prose is not that.
  // Nothing but this assertion holds the line.
  it('classifies README.md as wiring, NOT boilerplate — prose is hand-written', () => {
    expect(classifyPath('README.md')).toBe('wiring');
  });

  // Where the open "promote prompt markdown to core?" question surfaces. In THIS
  // repo an agent prompt is behaviour, and calling it boilerplate would collapse
  // it by default so a reviewer never opens it. Today it is wiring; if that is
  // ever promoted to core, this is the test that must be edited on purpose.
  it('classifies agent-prompt markdown as wiring (today’s decision, not an accident)', () => {
    expect(classifyPath('docs/agent-prompts/reviewer.md')).toBe('wiring');
  });

  it('classifies build and tool configuration as wiring', () => {
    expectAll(
      ['vitest.config.ts', 'next.config.mjs', 'tsconfig.json', 'eslint.config.mjs'],
      'wiring',
    );
  });

  it('classifies barrels as wiring', () => {
    expect(classifyPath('client/src/lib/hooks/index.ts')).toBe('wiring');
  });

  // Routes are arguably core — this pins the call. A route handler in this
  // codebase parses, delegates and maps a status code; the logic a reviewer is
  // looking for is in the `service.ts` next door.
  it('classifies a route module as wiring, not core', () => {
    expect(classifyPath('server/src/modules/pulls/routes.ts')).toBe('wiring');
    // …and the service beside it stays core, which is the half that makes the
    // decision above meaningful rather than a blanket demotion of the folder.
    expect(classifyPath('server/src/modules/pulls/service.ts')).toBe('core');
  });

  it('classifies migrations, CI workflows and ambient types as wiring', () => {
    expectAll(
      [
        'server/src/db/migrations/0012_add_x.sql',
        '.github/workflows/lint.yml',
        'types/global.d.ts',
      ],
      'wiring',
    );
  });
});

describe('classifyPath — core', () => {
  it('classifies business logic as core', () => {
    expectAll(
      ['server/src/modules/reviews/service.ts', 'server/src/modules/smart-diff/classify.ts'],
      'core',
    );
  });

  // An over-broad `vendor/` or `components/` pattern — added to make the
  // vendored-copy case above pass — swallows this file, and the feature quietly
  // stops surfacing the component a PR actually changed.
  it('keeps a real component core, though a vendored one is boilerplate', () => {
    expect(classifyPath('client/src/components/diff-viewer/FileCard/FileCard.tsx')).toBe('core');
    expect(classifyPath('client/src/vendor/ui/button.tsx')).toBe('boilerplate');
  });

  // Core is the FALLBACK, not a pattern list: an unrecognised file is sorted to
  // the top rather than hidden. Inverting that (adding CORE_PATTERNS and
  // defaulting elsewhere) would make "a reviewer never sees it" the failure mode.
  it('falls back to core for a path no list claims', () => {
    expectAll(['main.rb', 'src/pkg/handler.go', 'weird-file-with-no-extension'], 'core');
  });
});

describe('classifyPath — evaluation order', () => {
  // Structural, and nothing in the type signature protects it: reordering the
  // two blocks in `classify.ts` compiles, type-checks, and reverses both
  // decisions in silence.
  it('resolves a path matching BOTH lists as boilerplate — generated wins', () => {
    // The overlap must be REAL or the assertion below is vacuous: a build-emitted
    // config file matches `dist/` (boilerplate) and `*.config.*` (wiring).
    expect(BOILERPLATE_PATTERNS.some((p) => p.test('dist/next.config.js'))).toBe(true);
    expect(WIRING_PATTERNS.some((p) => p.test('dist/next.config.js'))).toBe(true);
    expect(classifyPath('dist/next.config.js')).toBe('boilerplate');

    // The other named example. Today the wiring rule is tight enough
    // (`(^|\/)package\.json$`) that only the boilerplate list claims the
    // lock-file — so this asserts the RESOLUTION that protects the acceptance
    // criterion if the wiring rule is ever loosened by one character.
    expect(classifyPath('package-lock.json')).toBe('boilerplate');
  });
});

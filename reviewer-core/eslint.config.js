import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Lint lane for `@devdigest/reviewer-core` — ring 0.
 *
 * This package has exactly one architectural rule, and `AGENTS.md` already states
 * it: "No side effects except the injected `LLMProvider`. No DB, no GitHub, no
 * filesystem, no `process.env`." That purity is what makes the engine testable
 * with a stub provider and no Docker, and it is the reason the server can import
 * this package's raw TypeScript at all.
 *
 * Everything below exists to make a violation fail the build instead of a review.
 *
 * `src/llm/**` is scoped separately, and deliberately. `AGENTS.md` names it as
 * the provider folder, so a vendor SDK and a `fetch` are what that code IS —
 * flagging them would be flagging the package's own design. Everything the SDK
 * cannot justify (filesystem, subprocess, database, web framework, env) stays
 * forbidden there too, and the pure core — prompt assembly, grounding, the review
 * pipeline, the CI payload — keeps the full ban.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'eslint.config.js'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: { console: 'readonly', fetch: 'readonly', AbortSignal: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // A dead initializer is worth seeing, never worth an unrequested edit to
      // the engine that produces every review.
      'no-useless-assignment': 'warn',
    },
  },

  // ---- The pure core: no I/O of any kind ----------------------------------
  {
    files: ['src/**/*.ts'],
    ignores: ['src/llm/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'node:*', 'fs', 'fs/promises', 'path', 'child_process', 'crypto', 'os',
                'drizzle-orm', 'drizzle-orm/*', 'fastify', 'octokit', '@octokit/*',
                'openai', 'openai/*', '@anthropic-ai/sdk', 'postgres', 'simple-git',
              ],
              message:
                'reviewer-core is ring 0: pure logic, no I/O beyond the injected LLMProvider (reviewer-core/AGENTS.md). If you need this, it belongs in the server and reaches the engine as an argument or a callback.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'No network calls in ring 0 — the injected LLMProvider is the only way out.' },
        { name: 'process', message: 'No process.env in ring 0 — the caller resolves configuration and passes it in.' },
      ],
    },
  },

  // ---- Providers: an SDK is the point; everything else still is not -------
  {
    files: ['src/llm/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'node:fs', 'node:fs/promises', 'fs', 'fs/promises',
                'node:child_process', 'child_process',
                'drizzle-orm', 'drizzle-orm/*', 'fastify', 'postgres', 'simple-git',
                'octokit', '@octokit/*',
              ],
              message:
                'A provider talks to its model API and nothing else. Persistence, the filesystem and the web framework live in the server package.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'No process.env in this package — the caller resolves the key and passes it to the constructor.' },
      ],
    },
  },

  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
    },
  },
);

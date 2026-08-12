import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Lint lane for `@devdigest/mcp`.
 *
 * Three rules exist here that exist nowhere else in the repo, and each one
 * guards something a review pass would have to remember:
 *
 * 1. **stdout is the protocol channel.** On a stdio MCP server every byte
 *    written to stdout is framed JSON-RPC. One `console.log` corrupts the
 *    stream and the client reports a parse error, not a stray log line.
 *    Diagnostics go to stderr — `console.error`, which is allowed.
 *
 * 2. **Never the reviewer-core barrel.** `reviewer-core/src/index.ts` re-exports
 *    `OpenRouterProvider`, so importing the barrel pulls the `openai` SDK into
 *    this package's tree. `wrapUntrusted` is reached by sub-path.
 *
 * 3. **No model SDK, no prompt assembly.** `INJECTION_GUARD`
 *    (`reviewer-core/src/prompt.ts`) is the one shared defense on every review
 *    path. A model call made from here would be a review path without it. This
 *    package talks to the local API over HTTP and to nothing else.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'eslint.config.js', 'vitest.config.ts'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: {
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        AbortSignal: 'readonly',
        AbortController: 'readonly',
        Response: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
        TextEncoder: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // ---- src/: stdout belongs to the protocol, and the model belongs elsewhere
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-console': ['error', { allow: ['error', 'warn'] }],
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'stdout',
          message:
            'stdout is the MCP protocol channel on a stdio transport — writing to it corrupts the JSON-RPC stream. Log to stderr via src/log.ts.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@devdigest/reviewer-core',
              message:
                'The reviewer-core barrel re-exports OpenRouterProvider and drags in the `openai` SDK. Import by sub-path: `@devdigest/reviewer-core/prompt.js`.',
            },
          ],
          patterns: [
            {
              group: [
                'openai',
                'openai/*',
                '@anthropic-ai/sdk',
                '@anthropic-ai/*',
                'drizzle-orm',
                'drizzle-orm/*',
                'postgres',
                'fastify',
                '@devdigest/reviewer-core/review/*',
                '@devdigest/reviewer-core/llm/*',
              ],
              message:
                'This package is a transport adapter: no database, no model call, no prompt assembly. A model call from here would be a review path without INJECTION_GUARD (AGENTS.md invariant). It talks HTTP to the local API and nothing else.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      'no-restricted-imports': 'off',
      'no-restricted-properties': 'off',
    },
  },
);

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Lint lane for `@devdigest/api`.
 *
 * Its real job is the ONION DEPENDENCY RULE — `.claude/skills/onion-architecture`
 * §2: an outer ring may name an inner one, never the reverse. Until now that rule
 * lived only in prose and was enforced by review, which is why §15 ships a table
 * of known violations. Everything below is that table turned into a red squiggle.
 *
 * The style rules are deliberately thin: this config exists to hold an
 * architecture, not to relitigate formatting.
 *
 * Ring map (skill §15):
 *   0 core       ../reviewer-core/src
 *   1 contracts  src/vendor/shared, src/platform/{errors,resilience}.ts
 *   2 use cases  src/modules/<f>/service.ts, run-executor.ts, repo-intel/pipeline
 *   3 adapters   src/modules/<f>/{routes,repository}.ts, src/adapters, src/db
 *   RC root      src/platform/container.ts, src/app.ts, src/server.ts
 */

/** Ring-2 code orchestrates. It never speaks SQL, HTTP, fs or a vendor SDK (§7). */
const RING_2_FORBIDDEN = [
  {
    group: ['drizzle-orm', 'drizzle-orm/*'],
    message:
      'Ring 2 (use case) may not touch the ORM — onion §7. Move the query into the feature\'s repository.ts (ring 3) and call it from here.',
  },
  {
    group: ['**/db/schema', '**/db/schema.js', '**/db/schema/*'],
    message:
      'A table definition is ring 3 — onion §5. Take the shape from a contract in vendor/shared instead, so the service does not change when a column does.',
  },
  {
    group: ['fastify', 'fastify/*', '@fastify/*'],
    message:
      'A service must not know it was reached over HTTP — onion §7. Accept plain arguments; let routes.ts do the transport.',
  },
  {
    group: ['node:fs', 'node:fs/promises', 'fs', 'fs/promises', 'node:child_process', 'child_process'],
    message:
      'Filesystem and process access are ring 3 — onion §3. Put it behind a port in vendor/shared/adapters.ts with an implementation in adapters/ and a double in adapters/mocks.ts.',
  },
  {
    group: ['octokit', '@octokit/*', 'openai', '@anthropic-ai/sdk', 'simple-git', '@ast-grep/napi'],
    message:
      'A vendor SDK is ring 3 — onion §4. The service depends on the port interface the container hands it, never on the client library.',
  },
];

/** Ring-3 transport parses, delegates and maps a status code — nothing else (§9). */
const TRANSPORT_FORBIDDEN = [
  {
    group: ['drizzle-orm', 'drizzle-orm/*'],
    message:
      'A route handler may not contain SQL — onion §9. Give this feature a repository.ts and a service.ts (modules/repos/ is the reference shape).',
  },
  {
    group: ['**/db/schema', '**/db/schema.js', '**/db/schema/*'],
    message:
      'A route handler may not read the table definitions — onion §9. Move the query into repository.ts.',
  },
];

/**
 * Features are siblings; one may not reach into another's private files (§11).
 *
 * The pattern is gitignore-style, so `*` happily matches a literal `..` — which
 * makes a bare `../*&#47;**` swallow every legitimate `../../platform/…` and
 * `../../db/…` import too. The negations put those back. Consequence worth
 * knowing: a file one level deeper (`modules/reviews/repository/*.ts`) reaches a
 * sibling through `../../`, so it is under-enforced here rather than drowned in
 * false positives.
 */
const SIBLING_MODULE = {
  group: ['../*/**', '!../_shared/**', '!../../**'],
  message:
    'Cross-feature import — onion §11. A sibling module is a private implementation: get shared data from the container (container.agentsRepo / container.reviewRepo), promote a shared type to vendor/shared, or duplicate the literal.',
};

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'clones/**',
      'node_modules/**',
      // Vendored contracts (copied from the source of truth) and generated
      // migration SQL/journal are not ours to lint.
      'src/vendor/**',
      'src/db/migrations/**',
      'drizzle.config.ts',
      'eslint.config.js',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: { console: 'readonly', process: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', URL: 'readonly', fetch: 'readonly', AbortController: 'readonly', AbortSignal: 'readonly' },
    },
    rules: {
      // Signal, not style. `any` and unused args are worth seeing but must never
      // be the reason a boundary violation scrolls off the screen.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],

      // §10 — an adapter failure that is caught, unlogged and unreplaced is the
      // outage the resilience wrappers exist to surface.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // ---- Ring 2: use cases ---------------------------------------------------
  {
    files: [
      'src/modules/*/service.ts',
      'src/modules/*/run-executor.ts',
      'src/modules/*/diff-loader.ts',
      'src/modules/*/pipeline/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...RING_2_FORBIDDEN, SIBLING_MODULE] }],
    },
  },

  // ---- Ring 3: transport ---------------------------------------------------
  {
    files: ['src/modules/*/routes.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...TRANSPORT_FORBIDDEN, SIBLING_MODULE] }],
    },
  },

  // ---- Ring 3: repositories + helpers -------------------------------------
  // SQL is expected here; the sibling boundary still holds.
  {
    files: ['src/modules/*/repository.ts', 'src/modules/*/repository/**/*.ts', 'src/modules/*/helpers.ts', 'src/modules/*/constants.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [SIBLING_MODULE] }],
    },
  },

  // ---- Ring 3: adapters ----------------------------------------------------
  // The arrow points inward. An adapter that imports a feature is backwards (§14).
  {
    files: ['src/adapters/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/modules/**'],
              message:
                'An adapter importing a feature module is the dependency arrow backwards — onion §14. Move what it needs into ring 1 (vendor/shared) or into the adapter itself.',
            },
            {
              group: ['**/db/seed', '**/db/seed.js'],
              message:
                'db/seed.ts is a script, not a contract. Put the constant in ring 1 and import it from both places.',
            },
          ],
        },
      ],
    },
  },

  // ---- Config boundary -----------------------------------------------------
  // §3: env is read in one place, secrets come from SecretsProvider.
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/platform/config.ts',
      'src/adapters/secrets/**',
      'src/db/migrate.ts',
      'src/db/seed.ts',
      // Documented exception: sets git's own env vars on the inherited process
      // env so cloned subprocesses can never open an interactive prompt.
      'src/adapters/git/simple-git.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'Read configuration in platform/config.ts and secrets through SecretsProvider — onion §3. Scattered env reads make it impossible to say what this service actually needs.',
        },
      ],
    },
  },

  // ---- Tests ---------------------------------------------------------------
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', fetch: 'readonly', AbortController: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
      // Tests print diagnostics on purpose.
      'no-console': 'off',
    },
    linterOptions: { reportUnusedDisableDirectives: false },
  },
);

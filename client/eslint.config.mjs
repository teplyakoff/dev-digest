import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Lint lane for `@devdigest/web`.
 *
 * Encodes `.claude/skills/frontend-architecture` §14 (the DevDigest section) and
 * `nextjs.md` §8. Those documents describe the architecture that was actually
 * chosen here — external HTTP API, no DAL, no Server Actions, every data hook in
 * `src/lib/hooks/*` — and this file is what keeps a diff from quietly leaving it.
 *
 * Two rules below (inline style objects, barrel files) fire on code that predates
 * them. Rather than water the rules down, the existing occurrences live in
 * `eslint-suppressions.json`: the count can go down but never up, so the rule is
 * an error for new code and silent for old. Regenerate with `pnpm lint:baseline`
 * only when a deliberate migration lowers the numbers.
 */
export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      // Vendored: the design-system primitives and the Zod contracts copied from
      // the server. Edit the source, then re-vendor — never lint them into shape.
      'src/vendor/**',
      'next.config.*',
      'postcss.config.*',
      'eslint.config.mjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly', document: 'readonly', console: 'readonly', fetch: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly',
        clearInterval: 'readonly', localStorage: 'readonly', navigator: 'readonly',
        URLSearchParams: 'readonly', EventSource: 'readonly', AbortController: 'readonly',
        HTMLElement: 'readonly', HTMLDivElement: 'readonly', HTMLInputElement: 'readonly',
        HTMLTextAreaElement: 'readonly', KeyboardEvent: 'readonly', MouseEvent: 'readonly',
        React: 'readonly', RequestInit: 'readonly', Response: 'readonly', process: 'readonly',
        requestAnimationFrame: 'readonly', ResizeObserver: 'readonly', getComputedStyle: 'readonly',
        matchMedia: 'readonly', MutationObserver: 'readonly', queueMicrotask: 'readonly',
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // The two rules that catch real bugs rather than taste. `exhaustive-deps`
      // would already have flagged the useMemo on the PR-detail page, whose
      // dependency list names `reviews` while the body reads `runs`.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // ---- Styling: one system, not two ---------------------------------------
  // Variant A of the plan: `styles.ts` beside the component stays the convention;
  // what stops is new inline objects. An inline `style={{…}}` is also a fresh
  // object identity every render (react-best-practices § Inline Creation in JSX).
  {
    files: ['src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression",
          message:
            "Inline style object. Move it to this folder's styles.ts (frontend-architecture §9) — an inline object is also a new reference on every render.",
        },
      ],
    },
  },

  // ---- Data access ---------------------------------------------------------
  // "Every data hook goes through src/lib/hooks/*, which calls src/lib/api.ts —
  // never fetch in a component" (§14). Reaching for the query client in a page is
  // how a query key leaks out of the module that owns it (§10).
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    ignores: ['**/*.test.tsx', '**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tanstack/react-query',
              importNames: ['useQuery', 'useMutation', 'useQueryClient', 'useInfiniteQuery'],
              message:
                'Data access belongs in src/lib/hooks/* — frontend-architecture §14. For cross-domain invalidation, export a named invalidator from the hook file that owns the key (§10) and call that instead of holding the query client here.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Never fetch in a component — frontend-architecture §14. Add a hook in src/lib/hooks/<domain>.ts on top of src/lib/api.ts.' },
      ],
    },
  },

  // ---- Environment boundary ------------------------------------------------
  // Only NEXT_PUBLIC_* reaches the browser, and a missed prefix fails silently
  // as an empty string (nextjs.md §6). One module reads env: src/lib/api.ts.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/api.ts', 'src/i18n/**', 'src/test/**', '**/*.test.tsx', '**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'Confine env reads to src/lib/api.ts — nextjs.md §6. A non-NEXT_PUBLIC_ variable read here is silently an empty string, not an error.',
        },
      ],
    },
  },

  // ---- No new barrels ------------------------------------------------------
  // §12: a barrel makes the bundler pull every re-exported module to resolve one
  // import. Existing ones stay (removing them is its own migration) — the rule
  // exists so the count stops growing.
  {
    files: ['src/**/index.ts', 'src/**/index.tsx'],
    ignores: ['src/vendor/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportAllDeclaration',
          message: 'No new barrel files — frontend-architecture §12. Import the module directly.',
        },
        {
          selector: 'ExportNamedDeclaration[source]',
          message: 'No new barrel files — frontend-architecture §12. Import the module directly.',
        },
      ],
    },
  },

  // ---- Route entries -------------------------------------------------------
  // nextjs.md §4: a page binds a URL to a view. A component defined in a page
  // file cannot be moved, tested or promoted without touching routing.
  {
    files: ['src/app/**/page.tsx', 'src/app/**/layout.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression",
          message:
            "Inline style object. Move it to this folder's styles.ts (frontend-architecture §9).",
        },
      ],
    },
  },

  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
      'no-restricted-properties': 'off',
    },
  },
);

import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest does NOT read tsconfig `paths`. Every alias in `tsconfig.json` must be
 * mirrored here or the package type-checks green and every test dies on import.
 *
 * The reviewer-core alias is a regex on purpose: it rewrites the TypeScript
 * `.js` specifier straight onto the real `.ts` file, so `@devdigest/reviewer-core/prompt.js`
 * resolves without relying on Vite's implicit `.js` → `.ts` fallback. It is also
 * deliberately sub-path only — `reviewer-core/src/index.ts` re-exports
 * `OpenRouterProvider` and would pull the `openai` SDK in behind it.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@devdigest\/reviewer-core\/(.*)\.js$/,
        replacement: path.resolve(__dirname, '../reviewer-core/src/$1.ts'),
      },
      {
        find: /^@devdigest\/shared$/,
        replacement: path.resolve(__dirname, '../server/src/vendor/shared'),
      },
      {
        find: /^@devdigest\/shared\/(.*)$/,
        replacement: path.resolve(__dirname, '../server/src/vendor/shared/$1'),
      },
      // Mirrors the tsconfig self-pin. Without it the aliased contract files
      // resolve `zod` from `server/node_modules`, giving the process two zod
      // instances — the exact condition that makes `instanceof z.ZodError`
      // false, which `server/src/app.ts:138-142` already carries a workaround for.
      { find: /^zod$/, replacement: path.resolve(__dirname, 'node_modules/zod') },
    ],
  },
  test: {
    environment: 'node',
    // NOTE: no `*.it.test.ts` here, and there must never be one. In this repo
    // that suffix means DB-backed via testcontainers (AGENTS.md), and nothing in
    // this package touches a database. Every test here is hermetic: zero HTTP,
    // zero spend.
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
  },
});

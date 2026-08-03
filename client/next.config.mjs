import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001",
  },

  eslint: {
    /**
     * Linting runs in its own lane (`pnpm lint`, and the `lint` CI workflow) —
     * not inside the build.
     *
     * Not a way to dodge the rules: `next build` invokes ESLint through its own
     * runner, which does not read `eslint-suppressions.json`. That file is what
     * holds the pre-existing inline-style and barrel violations, so leaving this
     * on would fail every build on debt that the lint lane deliberately accepts,
     * while adding nothing the lint lane does not already check.
     */
    ignoreDuringBuilds: true,
  },

  webpack: (config) => {
    /**
     * Resolve `./foo.js` specifiers to `foo.ts`.
     *
     * The vendored contracts in `src/vendor/shared/**` are copied verbatim from
     * the server, which is ESM-with-extensions, so every internal import reads
     * `from './contracts/findings.js'` while the file on disk is `.ts`.
     * TypeScript resolves that natively under `moduleResolution: "Bundler"`, and
     * Vitest handles it too — so type-check and unit tests were always happy.
     * Webpack does not do it by default.
     *
     * It went unnoticed because nothing here had ever imported
     * `@devdigest/shared` for a VALUE. `src/lib/types.ts` re-exports it with
     * `export type { … }`, which is erased at build time, so webpack never had
     * to resolve the chain at all. The first runtime import — a Zod schema, used
     * to validate an API response — turned the whole family into build errors at
     * once.
     *
     * Worth stating plainly: these are Zod schemas. Being usable at runtime is
     * the entire point of them, so the resolver was what needed fixing, not the
     * import.
     */
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);

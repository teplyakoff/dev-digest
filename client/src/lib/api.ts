/* api.ts — typed fetch client for the F1 Fastify engine (localhost:3001).
   All hooks build on `apiFetch`. Errors are normalized to ApiError so the
   error-UX taxonomy (toast/inline/full-screen) can branch on status. */

import type { ZodType } from "zod";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";

/**
 * Optional response validation, in development only.
 *
 * WHY: every response used to be `as T` — an unchecked assertion. That is
 * normally a fine trade, but this package's contracts are a HAND-COPIED vendored
 * duplicate of the server's, with no build step joining them, and both
 * INSIGHTS.md files record the same failure: add a field on the server, forget to
 * re-vendor, and the client keeps type-checking against its stale copy while the
 * component silently reads `undefined`. There is no error, no log, nothing to
 * grep — just a value that isn't there.
 *
 * `scripts/vendor-shared.sh --check` now catches drift in CI. This catches the
 * other direction, at runtime: a response whose SHAPE does not match what this
 * client believes it is getting.
 *
 * It never throws and never runs in production:
 *   - throwing would turn a cosmetic mismatch (a new field the UI ignores) into
 *     a broken screen, which is worse than the bug it is chasing;
 *   - in production the contracts have already been validated by the server's
 *     own response serializer, and paying for a second parse per request buys
 *     nothing.
 *
 * NO CALL SITE PASSES A SCHEMA TODAY, deliberately. Doing so measured at +15 kB
 * First Load JS on EVERY route: nothing in this package imported
 * `@devdigest/shared` for a value before (`lib/types.ts` re-exports it with
 * `export type`, which is erased), so the first schema import drags `zod` and
 * the contract chain into the production bundle — where `validateInDev` returns
 * on the first line and never uses them. A dev-only diagnostic should not be
 * paid for by every user on every page.
 *
 * The drift this was chasing is already caught at its source, deterministically
 * and for free, by `./scripts/vendor-shared.sh --check` in the `lint` workflow.
 * This stays as a debugging tool: pass a schema on one call while you are
 * chasing a shape mismatch, and take it back out. Making it permanent means
 * first making the schema import lazy enough to stay out of First Load JS.
 */
function validateInDev<T>(path: string, data: unknown, schema?: ZodType<T>): void {
  if (!schema || process.env.NODE_ENV === "production") return;
  const result = schema.safeParse(data);
  if (result.success) return;
  console.error(
    `[api] response from ${path} does not match its contract.\n` +
      `If a field the server "definitely returns" is missing, the vendored ` +
      `contracts have probably drifted — run ./scripts/vendor-shared.sh.\n`,
    result.error.issues,
  );
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  /** Contract to check the response against, in dev only. See `validateInDev`. */
  schema?: ZodType<T>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        // Only declare a JSON body when one is actually sent — otherwise a
        // body-less POST/PUT (e.g. tour generate, refresh, reindex) trips
        // Fastify's "Body cannot be empty when content-type is application/json".
        ...(init?.body != null ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    // network failure / API down → full-screen error candidate
    throw new ApiError(
      `Cannot reach the DevDigest engine at ${API_BASE}. Is the API running?`,
      0,
      "network_error",
      e
    );
  }

  if (!res.ok) {
    let code: string | undefined;
    let message = `${res.status} ${res.statusText}`;
    let details: unknown;
    try {
      const body = await res.json();
      if (body?.error) {
        code = body.error.code;
        message = body.error.message ?? message;
        details = body.error.details;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status, code, details);
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json();
  validateInDev(path, data, schema);
  return data as T;
}

export const api = {
  /** `schema` is optional and dev-only — pass it on reads whose shape matters. */
  get: <T>(path: string, schema?: ZodType<T>) => apiFetch<T>(path, undefined, schema),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};

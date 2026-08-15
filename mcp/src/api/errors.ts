/**
 * Ring 1 — the error taxonomy this package speaks.
 *
 * onion §10: adapters translate. A `fetch` rejection, an `ApiErrorBody`
 * envelope, a 429 from the review route's own rate limit — each becomes one of
 * these at the adapter boundary, and a library error never travels inward. The
 * tools then have exactly one thing to render.
 */

/** What went wrong, in terms a tool description can act on. */
export type ApiErrorKind =
  /** The API process is not listening (ECONNREFUSED / DNS / socket). */
  | 'unreachable'
  /** 404 — the id does not exist in this workspace. */
  | 'not_found'
  /** 422 — the request failed the route's Zod schema. `details` carries issues. */
  | 'validation'
  /** 429 — POST /pulls/:id/review is capped at 10/minute. */
  | 'rate_limited'
  /** 5xx, or `internal_error` in the envelope. */
  | 'server_error'
  /** A 200 whose body does not match the shared contract. */
  | 'contract_mismatch'
  /** Anything else with a status. */
  | 'request_failed';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  /** The `error.code` from `ApiErrorBody`, when the server sent an envelope. */
  readonly code: string | null;
  readonly details: unknown;

  constructor(
    kind: ApiErrorKind,
    message: string,
    opts: { status?: number | null; code?: string | null; details?: unknown } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = opts.status ?? null;
    this.code = opts.code ?? null;
    this.details = opts.details;
  }
}

/**
 * The one sentence worth more than a stack trace. By far the most common way
 * every tool in this package fails is that nobody started the API.
 */
export const API_DOWN_HINT =
  'the DevDigest API is not running; start it with `./scripts/dev.sh` (or `cd server && pnpm dev`)';

/** Map an `ApiErrorBody`-shaped response (server/src/app.ts:116-164) onto the taxonomy. */
export function kindForStatus(status: number, code: string | null): ApiErrorKind {
  if (status === 404) return 'not_found';
  if (status === 422 || code === 'validation_error') return 'validation';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  return 'request_failed';
}

/**
 * A `fetch` that cannot open a socket rejects with a `TypeError` whose real
 * reason is on `cause.code` — the string a user can act on is two levels down.
 */
export function isConnectionRefused(err: unknown): boolean {
  const codes = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EHOSTUNREACH', 'UND_ERR_SOCKET']);
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur);
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && codes.has(code)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/** Human text for one error, ready to go into a tool's `content`. */
export function describeApiError(err: ApiError): string {
  switch (err.kind) {
    case 'unreachable':
      return `Cannot reach the DevDigest API — ${API_DOWN_HINT}.`;
    case 'not_found':
      return `${err.message} (404 — it does not exist in this workspace).`;
    case 'validation':
      return `The API rejected the request as invalid: ${err.message}${
        err.details ? `\n${JSON.stringify(err.details)}` : ''
      }`;
    case 'rate_limited':
      return (
        `Rate limited by the API (429). \`POST /pulls/:id/review\` allows 10 calls per minute ` +
        `because each one can fan out to several billed LLM runs. Wait a minute and retry.`
      );
    case 'server_error':
      return `The DevDigest API returned a server error: ${err.message}`;
    case 'contract_mismatch':
      return (
        `The DevDigest API answered with a body that does not match the shared contract: ${err.message}. ` +
        `This is a version mismatch between the API and this MCP server, not something the caller can fix.`
      );
    default:
      return `The DevDigest API call failed${err.status ? ` (${err.status})` : ''}: ${err.message}`;
  }
}

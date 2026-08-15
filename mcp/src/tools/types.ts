import { z } from 'zod';
import { ApiError, describeApiError } from '../api/errors.js';
import type { ToolResult } from '../api/types.js';
import type { Deps } from '../deps.js';
import { ResolveError } from '../resolve.js';
import { textResult } from '../format.js';

/**
 * Ring 3 — the driving-adapter shape. onion §9: *"Jobs, streams, and CLIs are
 * transport too."* A tool handler is a route handler wearing a different hat,
 * and it obeys the same rule — parse, delegate, render. Anything with a loop or
 * two dependent awaits belongs in `usecases/`.
 */

/**
 * The slice of the SDK's `RequestHandlerExtra` this package uses, declared
 * structurally so no SDK type crosses inward (§5). `server.ts` passes the real
 * object; tests pass an object literal and need no SDK at all.
 */
export interface ToolExtra {
  /** Client-side cancellation. A long poll MUST watch this. */
  signal: AbortSignal;
  /** `progressToken` is present only when the client asked for progress. */
  _meta?: { progressToken?: string | number } | undefined;
  sendNotification: (notification: {
    method: 'notifications/progress';
    params: {
      progressToken: string | number;
      progress: number;
      total?: number;
      message?: string;
    };
  }) => Promise<void>;
}

export interface ToolDescriptor {
  name: string;
  config: {
    title: string;
    description: string;
    inputSchema: z.ZodTypeAny;
    outputSchema?: z.ZodTypeAny;
    annotations: {
      readOnlyHint: boolean;
      openWorldHint: boolean;
      idempotentHint?: boolean;
      destructiveHint?: boolean;
    };
  };
  /**
   * Takes `unknown`, not the inferred input type, and parses inside. The SDK
   * validates first, but re-parsing here is what applies `.default()` in the
   * unit tests and what makes each handler callable on its own — cheap
   * insurance against "the default silently never applied".
   */
  handler: (input: unknown, deps: Deps, extra: ToolExtra) => Promise<ToolResult>;
}

/**
 * Every failure leaves a handler as `isError: true` text, never as a throw.
 * A thrown error becomes a protocol-level error the model cannot reason about;
 * a text result is something it can read and correct.
 */
export function failure(err: unknown): ToolResult {
  if (err instanceof ApiError) return textResult(describeApiError(err), true);
  if (err instanceof ResolveError) return textResult(err.message, true);
  if (err instanceof z.ZodError) {
    const issues = err.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return textResult(`Invalid arguments — ${issues}`, true);
  }
  return textResult(`Unexpected failure: ${(err as Error)?.message ?? String(err)}`, true);
}

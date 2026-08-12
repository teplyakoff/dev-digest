/**
 * The polling loop behind `run_agent_on_pull_request`.
 *
 * SSE was the obvious alternative and is the wrong one here: `POST /pulls/:id/review`
 * already hands back the run ids, `RunBus` is in-memory (`server/src/platform/sse.ts:20-25`)
 * so an API restart breaks the stream while `agent_runs.status` still settles,
 * `{ all: true }` would need N connections where one poll covers every run, and
 * polling costs zero extra dependencies.
 */

/** 2 s → 5 s → 10 s, then 10 s forever. Tight at the start, cheap at 15 minutes. */
export const BACKOFF_MS = [2_000, 5_000, 10_000] as const;

export function backoffFor(tick: number): number {
  return BACKOFF_MS[Math.min(tick, BACKOFF_MS.length - 1)] ?? 10_000;
}

export type PollOutcome<T> =
  | { status: 'settled'; value: T; ticks: number; elapsedMs: number }
  | { status: 'timeout'; value: T | null; ticks: number; elapsedMs: number }
  | { status: 'aborted'; value: T | null; ticks: number; elapsedMs: number };

export interface PollOptions<T> {
  /** One poll. Given the signal so the HTTP call is cancelled with the tool call. */
  fetch: (signal: AbortSignal) => Promise<T>;
  done: (value: T) => boolean;
  maxWaitMs: number;
  /** Client-side cancellation (`extra.signal`). Checked before and after every wait. */
  signal: AbortSignal;
  /** Called after each poll that did NOT settle — this is where progress goes out. */
  onTick?: (info: { tick: number; elapsedMs: number; value: T }) => Promise<void> | void;
}

export async function pollUntil<T>(opts: PollOptions<T>): Promise<PollOutcome<T>> {
  const started = Date.now();
  let tick = 0;
  let last: T | null = null;

  for (;;) {
    // Checked BEFORE the first fetch: a client that cancelled while the POST was
    // in flight must not buy an extra request.
    if (opts.signal.aborted) {
      return { status: 'aborted', value: last, ticks: tick, elapsedMs: Date.now() - started };
    }

    // An abort that lands WHILE the request is in flight rejects here rather
    // than resolving, and the rejection is whatever `fetch` threw. Letting it
    // escape would surface a cancelled 15-minute call as "Unexpected failure:
    // This operation was aborted" with no run ids in it — strictly worse than
    // the abort that lands during the backoff sleep, which returns them. Both
    // paths have to end in the same outcome.
    let value: T;
    try {
      value = await opts.fetch(opts.signal);
    } catch (err) {
      if (opts.signal.aborted) {
        return { status: 'aborted', value: last, ticks: tick, elapsedMs: Date.now() - started };
      }
      throw err;
    }
    last = value;
    tick += 1;
    const elapsedMs = Date.now() - started;

    if (opts.done(value)) return { status: 'settled', value, ticks: tick, elapsedMs };
    if (opts.signal.aborted) return { status: 'aborted', value, ticks: tick, elapsedMs };

    await opts.onTick?.({ tick, elapsedMs, value });

    const delay = backoffFor(tick - 1);
    // Stop rather than sleep past the deadline: waking up only to declare a
    // timeout wastes the caller's patience and one more request.
    if (elapsedMs + delay >= opts.maxWaitMs) {
      return { status: 'timeout', value, ticks: tick, elapsedMs };
    }
    const interrupted = await sleep(delay, opts.signal);
    if (interrupted) {
      return { status: 'aborted', value, ticks: tick, elapsedMs: Date.now() - started };
    }
  }
}

/** @returns true when the wait ended because the signal aborted. */
export function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(false);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(true);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

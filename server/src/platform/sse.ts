import { EventEmitter } from 'node:events';
import type { RunEvent, RunEventKind } from '@devdigest/shared';

/**
 * SSE / run-log bus.
 *
 * During a run, events are pushed to an in-memory buffer and emitted live to
 * any SSE subscriber on `/runs/:id/events`. On completion the full log is
 * persisted as ONE document in `run_traces` (done by the service layer, not here).
 *
 * Event shape on the wire (SSE `data`): RunEvent (see @devdigest/shared).
 */

/** Wall-clock time-of-day (HH:MM:SS, local) stamped on each log line. */
function clockTime(): string {
  return new Date().toTimeString().slice(0, 8);
}

export class RunBus {
  private emitters = new Map<string, EventEmitter>();
  private buffers = new Map<string, RunEvent[]>();
  private seq = new Map<string, number>();
  private completed = new Set<string>();
  private cancelled = new Set<string>();
  private aborters = new Map<string, AbortController>();

  /**
   * Register the controller that can abort a run's in-flight LLM request.
   *
   * The executor calls this as the run starts. Cancelling then does two things:
   * sets the flag the between-chunk checkpoint reads, AND aborts the socket. The
   * flag alone was never enough — a single-pass review has one chunk, so the
   * checkpoint runs once and then the run is unreachable for however long the
   * provider takes (945 s, in the worst case on record).
   */
  registerAborter(runId: string, controller: AbortController): void {
    // A cancel that arrived before the run got going still applies.
    if (this.cancelled.has(runId)) controller.abort();
    else this.aborters.set(runId, controller);
  }

  /**
   * Request cancellation of an in-flight run: raise the flag the runner checks
   * at its next checkpoint, and abort the request already on the wire.
   */
  cancel(runId: string): void {
    this.cancelled.add(runId);
    this.aborters.get(runId)?.abort();
  }

  /** Whether cancellation has been requested for a run. */
  isCancelled(runId: string): boolean {
    return this.cancelled.has(runId);
  }

  private emitterFor(runId: string): EventEmitter {
    let e = this.emitters.get(runId);
    if (!e) {
      e = new EventEmitter();
      e.setMaxListeners(50);
      this.emitters.set(runId, e);
      // Preserve any existing buffer/seq (e.g. a late subscriber after the run
      // completed must still be able to replay the buffered events).
      if (!this.buffers.has(runId)) this.buffers.set(runId, []);
      if (!this.seq.has(runId)) this.seq.set(runId, 0);
    }
    return e;
  }

  /** Publish a live event for a run. Returns the constructed RunEvent. */
  publish(runId: string, kind: RunEventKind, msg: string, data?: unknown): RunEvent {
    const e = this.emitterFor(runId);
    const next = (this.seq.get(runId) ?? 0) + 1;
    this.seq.set(runId, next);
    const event: RunEvent = { runId, seq: next, kind, msg, t: clockTime(), data };
    this.buffers.get(runId)!.push(event);
    e.emit('event', event);
    return event;
  }

  /** Subscribe to live events. Replays any buffered events first. */
  subscribe(runId: string, listener: (e: RunEvent) => void): () => void {
    const e = this.emitterFor(runId);
    for (const buffered of this.buffers.get(runId) ?? []) listener(buffered);
    e.on('event', listener);
    return () => e.off('event', listener);
  }

  /** The full buffered log for a run (used to persist the trace on completion). */
  buffer(runId: string): RunEvent[] {
    return this.buffers.get(runId) ?? [];
  }

  /** Signal completion and release buffers/emitters. */
  complete(runId: string): void {
    const e = this.emitters.get(runId);
    this.completed.add(runId);
    this.cancelled.delete(runId);
    this.aborters.delete(runId);
    e?.emit('done');
    // Keep the buffer briefly available for late subscribers; clear emitter.
    this.emitters.delete(runId);
  }

  /** Whether a run has already completed (for replay-then-end late subscribers). */
  isComplete(runId: string): boolean {
    return this.completed.has(runId);
  }

  onDone(runId: string, listener: () => void): () => void {
    // A run that already completed fires immediately so late SSE subscribers,
    // after replaying the buffer, end the stream instead of hanging forever.
    if (this.completed.has(runId)) {
      queueMicrotask(listener);
      return () => undefined;
    }
    const e = this.emitterFor(runId);
    e.once('done', listener);
    return () => e.off('done', listener);
  }
}

export const runBus = new RunBus();

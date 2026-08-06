import { createHash, randomUUID } from 'node:crypto';
import type { PromptSection } from '@devdigest/reviewer-core';
import type { Tokenizer } from '../adapters/tokenizer/index.js';
import type { RunLogger } from './run-logger.js';

/**
 * Safe, structured logging of prompt assembly.
 *
 * ONE rule, and everything here follows from it: **describe the prompt, never
 * reproduce it.** A section contributes its name, its trust class, where it came
 * from, how big it is, and — only in local verbose mode — a digest. Never a
 * byte of the diff, a spec chunk, a PR body, a fetched plan or a secret.
 *
 * Why a module rather than a few `logger.info` calls at the call sites: the
 * unsafe version of this is one line long (`logger.info({ prompt })`) and looks
 * completely reasonable while writing it. Routing every prompt log through a
 * function whose input is `PromptSection[]` and whose output has no content
 * field makes the safe form the easy one and the unsafe form something you have
 * to go out of your way to write.
 *
 * WHERE IT GOES, and the split matters:
 *   - the SSE Live Log / persisted `run_traces.log` gets ONE human summary line,
 *     because that stream is a UI a person reads while a review runs;
 *   - the structured per-section record goes to **stdout only** (`RunLogger.detail`),
 *     because it is for ops and a ten-line dump per run would drown the Live Log.
 *
 * Note what is deliberately NOT here: the full prompt is already persisted, in
 * `run_traces.prompt_assembly`, and rendered in the trace drawer. That is a
 * different thing with different access — a workspace-scoped API read, not a log
 * line that lands in stdout, a file, and whatever ships logs off the box.
 */

/** What one section contributes to the record. No content field, by design. */
export interface PromptSectionRecord {
  /** Position in prompt order, so a reordering is visible without content. */
  i: number;
  name: string;
  trust: 'trusted' | 'untrusted';
  source: string;
  chars: number;
  tokens: number;
  /** sha256, first 12 hex. Verbose + local only. Compares two runs blind. */
  digest?: string;
}

export interface PromptLogMeta {
  /** Ties the classifier pass and every agent pass of one trigger together. */
  correlationId: string;
  /** Which model call this prompt is for. */
  stage: 'intent' | 'review';
  provider: string;
  model: string;
  /** The `agent_runs` row, when the prompt belongs to one. */
  runId?: string;
  /** Agent name, for the review stage. */
  agent?: string;
}

/** A correlation id: short enough to eyeball in a log, unique enough to grep. */
export function newCorrelationId(): string {
  return randomUUID().slice(0, 8);
}

/**
 * A URL reduced to `origin + path` for logging — query string and fragment
 * dropped, always.
 *
 * That is where credentials live: `?token=`, `?sig=`, `?X-Amz-Signature=`, a
 * Slack or Notion share link, a pre-signed S3 URL. The URL itself comes from a
 * PR body, so it is attacker-influenced *and* possibly the author's own secret,
 * and a log line is the worst place for either — stdout goes to a file and to
 * whatever ships logs off the box, with none of the workspace scoping the API
 * has.
 *
 * The UNREDACTED url still goes to `pr_intent.sources[].ref` and onto the card,
 * deliberately: showing an author which of their own links could not be read is
 * the entire point of the missing-context design, and that path is a
 * workspace-scoped read. Redaction is a property of the log, not of the record.
 *
 * Not a URL → returned unchanged; the callers pass repo paths and `#301` too.
 */
export function redactUrlForLog(ref: string): string {
  if (!/^https?:\/\//i.test(ref)) return ref;
  try {
    const u = new URL(ref);
    const suffix = u.search || u.hash ? ' (query redacted)' : '';
    return `${u.origin}${u.pathname}${suffix}`;
  } catch {
    // Unparseable but URL-shaped: keep the scheme+host guess, drop the rest.
    return `${ref.split(/[?#]/)[0]} (unparseable url, truncated)`;
  }
}

/**
 * Measure the sections. `verbose` adds the digest and nothing else.
 *
 * Token counting is best-effort by construction — `Tokenizer` falls back to a
 * chars/4 heuristic rather than throwing, because this is reporting and
 * reporting must never be the reason a review fails.
 */
export function buildPromptRecord(
  sections: PromptSection[],
  tokenizer: Tokenizer,
  verbose: boolean,
): PromptSectionRecord[] {
  return sections.map((s, i) => ({
    i,
    name: s.name,
    trust: s.trust,
    source: s.source,
    chars: s.text.length,
    tokens: tokenizer.count(s.text),
    ...(verbose ? { digest: createHash('sha256').update(s.text).digest('hex').slice(0, 12) } : {}),
  }));
}

/**
 * Emit both halves: one summary line to the run stream, the structured record to
 * stdout.
 *
 * The summary names every section and its token count, so "why is my skill not
 * in the prompt?" is answerable from the Live Log alone — which is the question
 * that made the skills-loading log line exist in the first place.
 */
export function logPromptAssembly(
  runLog: RunLogger,
  record: PromptSectionRecord[],
  meta: PromptLogMeta,
  verbose: boolean,
): void {
  const total = record.reduce((n, r) => n + r.tokens, 0);
  const breakdown = record.map((r) => `${r.name} ${r.tokens.toLocaleString('en-US')}`).join(' · ');

  runLog.info(
    `Prompt assembled [${meta.correlationId}] for ${meta.stage} on ${meta.provider}/${meta.model} — ` +
      `${record.length} section(s), ${total.toLocaleString('en-US')} tokens: ${breakdown}`,
  );

  runLog.detail('prompt.assembled', {
    correlationId: meta.correlationId,
    stage: meta.stage,
    provider: meta.provider,
    model: meta.model,
    ...(meta.runId ? { runId: meta.runId } : {}),
    ...(meta.agent ? { agent: meta.agent } : {}),
    sections: record,
    totalTokens: total,
    totalChars: record.reduce((n, r) => n + r.chars, 0),
    verbose,
  });
}

import type {
  IntentSource,
  PrIntentRecord,
  PrIntentView,
  Provider,
  UnifiedDiff,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { RunLogger } from '../../platform/run-logger.js';
import type { PullRow } from '../../db/rows.js';
import { NotFoundError } from '../../platform/errors.js';
import { IntentRepository } from './repository.js';
import {
  DEFAULT_INTENT_MODEL,
  DEFAULT_INTENT_PROVIDER,
  INTENT_MAX_TOKENS,
  INTENT_TIMEOUT_MS,
} from './constants.js';
import { collectSources } from './pipeline/sources.js';
import { buildIntentMessages } from './pipeline/prompt.js';
import { INTENT_EXTRACTION_SCHEMA_NAME, IntentExtraction } from './pipeline/schema.js';
import {
  applyConfidenceFloor,
  capScopeItems,
  renderIntentBlock,
  scopeFilterArmed,
  toIntentDto,
} from './helpers.js';

/**
 * The Intent classifier.
 *
 * collect (code) → classify (one cheap model call) → compute provenance (code)
 * → persist. The same four-step shape the Conventions Extractor proved, and only
 * the second step involves a model.
 *
 * THE MODEL PROPOSES, CODE DECIDES. The classifier returns exactly
 * `{summary, in_scope, out_of_scope, confidence}`. `sources` and
 * `missing_context` are computed by this service from what it actually managed
 * to collect, because a model asked to report its own sources will invent one
 * that sounds right — and those two fields are the entire mechanism by which an
 * unreachable link stays visible as unreachable. `confidence` is the one thing
 * the model may report, and the floor here can only lower it.
 *
 * NOT WIRED: `platform/model-router.ts`. Its `routeModel('intent', …)` has no
 * caller and only knows openai/anthropic, and `feature_models` supersedes it.
 * Wiring both would give this feature two model-selection mechanisms that
 * disagree — said here rather than left for the next reader to discover.
 */

/**
 * The record, plus whether THIS call paid for it.
 *
 * `reused` exists so the run trace cannot report a cost the run never incurred.
 * One trigger derives once and every queued agent reads the same row, and a
 * later trigger on an unchanged head reuses it again — so the record's
 * `tokens_in`/`tokens_out`/`cost_usd` belong to whichever run first derived it,
 * not to the run currently writing a trace. Rendering them unconditionally
 * would double-count the classifier across every subsequent run, which is the
 * same "do not bill from this row" hazard `server/INSIGHTS.md` records for
 * cancelled runs.
 */
export interface DeriveOutcome {
  record: PrIntentRecord;
  reused: boolean;
}

/** Everything a derivation needs, resolved by the caller. */
export interface DeriveContext {
  workspaceId: string;
  pull: Pick<PullRow, 'id' | 'number' | 'title' | 'body' | 'headSha'>;
  repo: { owner: string; name: string; fullName: string; clonePath: string | null };
  diff: UnifiedDiff;
}

export class IntentService {
  private repo: IntentRepository;

  constructor(private container: Container) {
    this.repo = new IntentRepository(container.db);
  }

  /** The card's read. 200 with `{intent: null}` before the first derivation. */
  async view(workspaceId: string, prId: string): Promise<PrIntentView> {
    await this.requirePull(workspaceId, prId);
    const row = await this.repo.get(prId);
    return { intent: row ? toIntentDto(row) : null };
  }

  /**
   * Re-derive from scratch, for `POST /pulls/:id/intent`.
   *
   * Synchronous, for the reasons `conventions/service.ts` records: the input is
   * bounded by `constants.ts`, the model is a cheap one, the call carries its own
   * `timeoutMs`, and one spinner beats a poll loop.
   *
   * A repo with no clone still derives — it simply records every `repo_file` as
   * unavailable. That is a thinner answer, not a failure, so it is not a 409.
   */
  async derive(workspaceId: string, prId: string): Promise<PrIntentView> {
    const pull = await this.requirePull(workspaceId, prId);
    const repoRow = await this.container.reviewRepo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    const diff = await this.container.loadPrDiff(workspaceId, pull, repoRow);
    const record = await this.deriveNow({
      workspaceId,
      pull,
      repo: {
        owner: repoRow.owner,
        name: repoRow.name,
        fullName: repoRow.fullName,
        clonePath: repoRow.clonePath,
      },
      diff,
    });
    return { intent: record };
  }

  /**
   * Derive only when there is nothing usable cached — the review path's entry
   * point.
   *
   * Stale means the head moved: an intent derived against a different commit
   * describes a different PR. Anything else reuses the row, so a three-agent
   * trigger pays for one derivation and all three agents read the same one.
   */
  async deriveIfStale(ctx: DeriveContext, runLog?: RunLogger): Promise<DeriveOutcome> {
    const existing = await this.repo.get(ctx.pull.id);
    if (existing && existing.headSha === ctx.pull.headSha) {
      const record = toIntentDto(existing);
      runLog?.info(
        `Intent: reusing the derivation for ${record.head_sha.slice(0, 7)} ` +
          `(confidence=${record.confidence}, ${record.sources.filter((s) => s.status === 'used').length} source(s) used) ` +
          `— no model call, this run is not billed for it`,
      );
      return { record, reused: true };
    }
    return { record: await this.deriveNow(ctx, runLog), reused: false };
  }

  /**
   * May the engine's scope filter drop out-of-scope findings for this record?
   *
   * Exposed as a method so the review executor never imports this module's
   * helpers — a sibling import is the coupling onion §11 exists to prevent, and
   * `container.intent` is the sanctioned route.
   */
  scopeFilterArmed(record: PrIntentRecord): boolean {
    return scopeFilterArmed(record);
  }

  /** The reviewer's prompt slot: claim + provenance, never fetched content. */
  renderIntentBlock(record: PrIntentRecord): string {
    return renderIntentBlock(record);
  }

  // -------------------------------------------------------------------------

  /**
   * One derivation, start to finish.
   *
   * The logging here is the requirement "log the prompt's constituent parts, the
   * chosen model, a token estimate, and the intent's sources — without recording
   * secrets or excess diff content". So it logs the COMPOSITION: kind, ref and
   * size per source, never a byte of any of them.
   */
  private async deriveNow(ctx: DeriveContext, runLog?: RunLogger): Promise<PrIntentRecord> {
    const { blocks, sources, missingContext } = await collectSources({
      title: ctx.pull.title,
      body: ctx.pull.body,
      clonePath: ctx.repo.clonePath,
      repo: { owner: ctx.repo.owner, name: ctx.repo.name },
      diff: ctx.diff,
      github: () => this.container.github(),
      sourceReader: this.container.sourceReader,
    });

    const messages = buildIntentMessages({
      repoFullName: ctx.repo.fullName,
      prNumber: ctx.pull.number,
      title: ctx.pull.title,
      blocks,
      missingContext,
    });

    // Token counting never throws — `Tokenizer` falls back to chars/4 — because
    // this is reporting, and reporting must never be why a derivation fails.
    const estimate = messages.reduce((n, m) => n + this.container.tokenizer.count(m.content), 0);

    // Built from `sources`, NOT from the block labels, because the two carry
    // different information and only one of them is worth reading. A label is
    // `linked-issue`; the source's `ref` is `#301`. A label is `changed-files`;
    // the ref is `14 file(s), 31 hunk header(s)`. The label answers "which slot
    // of the prompt", which nobody is asking — the ref answers "what did the
    // classifier actually see", which is the whole point of this line.
    //
    // Size still comes off the block, so each entry reads `kind ref(Nt)`. Kinds
    // with no block (`pr_title` is in the message header, `link` is never
    // fetched) simply have no size.
    const sizeOf = (kind: IntentSource['kind'], ref: string): string => {
      const label =
        kind === 'repo_file' ? `repo-file:${ref}` : kind.replace('_', '-');
      const block = blocks.find((b) => b.label === label);
      return block ? `(${this.container.tokenizer.count(block.text)}t)` : '';
    };
    const usedRefs = sources
      .filter((s) => s.status === 'used')
      .map((s) => `${s.kind} ${s.ref}${sizeOf(s.kind, s.ref)}`);
    runLog?.info(
      `Intent sources: ${usedRefs.join(' · ') || 'none'} — ` +
        `${estimate.toLocaleString('en-US')} tokens est.`,
    );
    const unavailable = sources.filter((s) => s.status === 'unavailable');
    if (unavailable.length > 0) {
      runLog?.info(
        `Intent: ${unavailable.length} source(s) unavailable — ` +
          unavailable.map((s) => `${s.kind} ${s.ref}${s.note ? ` (${s.note})` : ''}`).join('; '),
      );
    }

    const { provider, model } = await this.resolveModel(ctx.workspaceId);
    // LABEL THE ROLE, NOT JUST THE SLUG. The classifier default differs from the
    // seeded reviewer agents' model by the `-0731` suffix alone, so a log line
    // printing two near-identical slugs does not let a reader verify at a glance
    // that the classifier runs on its own cheap model. Dropping "(cheap pass)"
    // re-opens exactly the gap the model choice created.
    runLog?.tool(`INTENT CLASSIFIER model: ${provider}/${model} (cheap pass)`);

    const llm = await this.container.llm(provider);
    const result = await llm.completeStructured({
      model,
      schema: IntentExtraction,
      schemaName: INTENT_EXTRACTION_SCHEMA_NAME,
      messages,
      temperature: 0,
      maxTokens: INTENT_MAX_TOKENS,
      timeoutMs: INTENT_TIMEOUT_MS,
    });

    const inScope = capScopeItems(result.data.in_scope);
    const outOfScope = capScopeItems(result.data.out_of_scope);
    const confidence = applyConfidenceFloor(result.data.confidence, sources);

    const row = await this.repo.upsert({
      prId: ctx.pull.id,
      summary: result.data.summary,
      inScope,
      outOfScope,
      confidence,
      sources,
      missingContext,
      headSha: ctx.pull.headSha,
      provider,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
    });

    const used = sources.filter((s) => s.status === 'used').length;
    runLog?.result(
      `Intent derived (confidence=${confidence}, ${result.attempts} attempt${result.attempts === 1 ? '' : 's'}) — ` +
        `${inScope.length} in scope, ${outOfScope.length} out of scope, ` +
        `${used} source(s) used, ${unavailable.length} unavailable — ` +
        `${result.tokensIn.toLocaleString('en-US')} in / ${result.tokensOut.toLocaleString('en-US')} out` +
        // `attempts` matters: OpenRouter's `strict` enforcement varies by
        // provider and this call sets no `require_parameters`, so a schema miss
        // triggers a silent second request. Without the count in the log a
        // three-call run reads as a two-call run.
        (result.costUsd == null ? '' : ` · $${result.costUsd.toFixed(6)}`),
    );

    return toIntentDto(row);
  }

  /**
   * Workspace override, else this module's own default.
   *
   * The two happen to agree today — `review_intent`'s registry default IS
   * `DEFAULT_INTENT_MODEL` — but `container.featureModel` returns the override
   * only, and reading the absence rather than a resolved value keeps the default
   * documented in one place, next to the reasoning for the `-0731` suffix.
   */
  private async resolveModel(
    workspaceId: string,
  ): Promise<{ provider: Provider; model: string }> {
    const override = await this.container.featureModel(workspaceId, 'review_intent');
    if (override) return { provider: override.provider, model: override.model };
    return { provider: DEFAULT_INTENT_PROVIDER, model: DEFAULT_INTENT_MODEL };
  }

  /**
   * Resolve the PR IN THIS WORKSPACE. Every entry point goes through here first,
   * because `pr_intent` has no `workspace_id` of its own — this lookup IS the
   * tenancy boundary, and a `prId` that reaches the repository without it is a
   * cross-tenant read.
   */
  private async requirePull(workspaceId: string, prId: string): Promise<PullRow> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return pull;
  }
}

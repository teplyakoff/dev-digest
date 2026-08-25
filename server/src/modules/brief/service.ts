import type { PrBriefView, Provider } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { PinoLike } from '../../platform/run-logger.js';
import type { PullRow } from '../../db/rows.js';
import { NotFoundError } from '../../platform/errors.js';
import { redactUrlForLog } from '../../platform/prompt-log.js';
import { BriefRepository } from './repository.js';
import { toBriefDto } from './helpers.js';
import {
  BRIEF_MAX_SCHEMA_RETRIES,
  BRIEF_MAX_TOKENS,
  BRIEF_TIMEOUT_MS,
  BRIEF_TOKEN_BUDGET,
  DEFAULT_BRIEF_MODEL,
  DEFAULT_BRIEF_PROVIDER,
} from './constants.js';
import { collectBriefInput, renderBriefBlocks } from './pipeline/sources.js';
import { assembleBriefMessages } from './pipeline/prompt.js';
import { fitToBudget } from './pipeline/budget.js';
import { groundBrief, groundingSummary } from './pipeline/grounding.js';
import { BRIEF_EXTRACTION_SCHEMA_NAME, BriefExtraction } from './pipeline/schema.js';

/**
 * The PR brief.
 *
 * collect (code) → assemble (code) → budget over the assembled messages (code)
 * → ONE structured model call → ground (code) → persist. The same four-step
 * shape the Intent classifier and the Conventions Extractor proved, and only the
 * fourth step involves a model.
 *
 * THE MODEL PROPOSES, CODE DECIDES, and here that is not a slogan: the model's
 * risks are checked against an allowlist built from the impact map, and the ones
 * that cite nothing or cite something outside it do not survive. `pipeline/
 * grounding.ts` holds that rule; this file only calls it and reports the ratio.
 *
 * NO HTTP AND NO SQL IN HERE (onion §7). It throws taxonomy errors and lets
 * `routes.ts` translate them; every read and write goes through a repository or
 * through the container.
 *
 * THE LOG RECORDS COMPOSITION, NEVER CONTENT (A09). Kind, ref and size per
 * source — not one byte of a PR body, an issue or a project document.
 */

/** The fields this service reads off a pull row; no ORM row travels outward. */
type BriefPull = Pick<
  PullRow,
  'id' | 'repoId' | 'headSha' | 'number' | 'title' | 'body' | 'base'
>;

export class BriefService {
  private repo: BriefRepository;

  /**
   * Builds currently in flight, by PR.
   *
   * TWO SIMULTANEOUS POSTS MUST NOT BE TWO BILLED BUILDS. The second request
   * awaits the first one's promise instead of starting its own call and racing
   * it to the upsert — where the older build can land last and overwrite the
   * newer row. AC-18 is untouched by this: it requires a rebuild on an unchanged
   * head, not a separate model call per HTTP request. The rate limit (AC-19) is
   * a different bound and does not replace this one — 10/minute still permits
   * ten at once.
   */
  private inflight = new Map<string, Promise<PrBriefView>>();

  constructor(private container: Container) {
    this.repo = new BriefRepository(container.db);
  }

  /**
   * The card's read. 200 with `{brief: null}` before the first build (AC-67).
   *
   * NEVER BUILDS. A GET that could spend a model call turns opening a page into
   * a purchase; the mirror of `GET /pulls/:id/intent`.
   */
  async view(workspaceId: string, prId: string): Promise<PrBriefView> {
    const pull = await this.requirePull(workspaceId, prId);
    const row = await this.repo.get(prId);
    if (!row) {
      // Not an error and not a 404: "never built" is a state the card renders as
      // an invitation, and the PR itself exists (AC-67).
      return { brief: null, stale: false, reused: false, model_calls: 0 };
    }
    return {
      brief: toBriefDto(row),
      // A moved head means this brief describes a different set of commits
      // (AC-17). The row is still returned — a stale brief marked stale is more
      // useful than no brief at all.
      stale: row.headSha !== pull.headSha,
      // Reused either way: nothing was called, and AC-20 is about what THIS
      // request spent, not about how fresh the answer is.
      reused: true,
      model_calls: 0,
    };
  }

  /**
   * Build a brief for one PR, spending exactly one model call on the brief
   * itself and at most one more on the intent it needs.
   *
   * UNCONDITIONAL (AC-18): a rebuild on an unchanged head really rebuilds. The
   * button means "do it again", and a version of it that quietly returned the
   * cached row would be a button that does nothing.
   *
   * @param workspaceId the caller's workspace — the tenancy key, not a hint
   */
  async build(workspaceId: string, prId: string, logger?: PinoLike): Promise<PrBriefView> {
    // TENANCY BEFORE COALESCING, and the order is load-bearing: joining the
    // in-flight map first would hand workspace B the brief of a PR that belongs
    // to workspace A, because the map is keyed by PR and the check is what makes
    // that PR this caller's to see.
    const pull = await this.requirePull(workspaceId, prId);

    const running = this.inflight.get(prId);
    if (running) return running;

    const promise = this.buildNow(workspaceId, pull, logger).finally(() => {
      this.inflight.delete(prId);
    });
    this.inflight.set(prId, promise);
    return promise;
  }

  private async buildNow(
    workspaceId: string,
    pull: BriefPull,
    logger?: PinoLike,
  ): Promise<PrBriefView> {
    const prId = pull.id;
    const repoRow = await this.container.reviewRepo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    // INTENT FIRST, AND ONLY IF STALE (AC-3, AC-4). `deriveIfStale` reuses a
    // record derived against this head without calling anything, so a warm PR
    // costs one call and a cold one costs two — and `model_calls` reports which
    // happened rather than asking the reader to guess (AC-5, NFR-3).
    const diff = await this.container.loadPrDiff(workspaceId, pull, repoRow);
    const outcome = await this.container.intent.deriveIfStale({
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
    const modelCalls = (outcome.reused ? 0 : 1) + 1;

    const input = await collectBriefInput(this.container, workspaceId, prId, {
      intent: outcome.record,
    });

    // BUDGET BEFORE ANYTHING IS SENT (AC-22, AC-26). `fitToBudget` throws when
    // the input still does not fit after every level, and it throws HERE —
    // before `container.llm(...)` is even resolved. That ordering is the second
    // half of AC-26: "no request was sent" is a property of this line's
    // position, not of a promise made in a comment.
    const fit = fitToBudget(
      input,
      assembleBriefMessages,
      this.container.tokenizer,
      BRIEF_TOKEN_BUDGET,
    );

    this.logComposition(logger, prId, fit.input, fit.tokens, fit.dropped);

    const { provider, model } = await this.resolveModel(workspaceId);
    // LABEL THE ROLE, NOT JUST THE SLUG. Two model-backed features can run the
    // same slug; a log line that names only the slug cannot tell a reader which
    // of them just spent money.
    logger?.info(
      { pr_id: prId, provider, model, stage: 'brief' },
      `PR BRIEF model: ${provider}/${model} (one structured pass)`,
    );

    const llm = await this.container.llm(provider);
    const result = await llm.completeStructured({
      model,
      schema: BriefExtraction,
      schemaName: BRIEF_EXTRACTION_SCHEMA_NAME,
      messages: fit.messages,
      temperature: 0,
      maxTokens: BRIEF_MAX_TOKENS,
      timeoutMs: BRIEF_TIMEOUT_MS,
      // EXPLICIT, and AC-27 is only met because it is: the provider's own
      // default is `?? 2`, which allows three requests for one brief.
      maxRetries: BRIEF_MAX_SCHEMA_RETRIES,
    });

    if (result.attempts > 1) {
      // Its own line, because the schema-repair round is where a cheap call
      // becomes an expensive one and nothing else in the log distinguishes the
      // two (`server/INSIGHTS.md`, 2026-08-06: 2 attempts → 8 378 output
      // tokens against a budgeted ~300).
      logger?.info(
        { pr_id: prId, attempts: result.attempts, tokens_out: result.tokensOut },
        `brief: the schema was repaired — ${result.attempts} attempts for one brief`,
      );
    }

    // GROUND AGAINST WHAT THE MODEL WAS ACTUALLY SHOWN — `fit.input`, not the
    // collected original. An allowlist built from endpoints the budget dropped
    // would accept a citation the model had no honest way to make.
    const grounded = groundBrief(fit.input, result.data);

    // UNCONDITIONALLY (AC-11, NFR-5). A gate that speaks only when it acts is
    // indistinguishable from one that never ran.
    logger?.info(
      {
        pr_id: prId,
        grounding: groundingSummary(grounded),
        kept: grounded.keptRisks,
        total: grounded.totalRisks,
      },
      `Risk grounding: ${groundingSummary(grounded)}` +
        (grounded.dropped.length === 0 ? ' — every risk cited the input' : ''),
    );
    for (const d of grounded.dropped) {
      // The reason per item, in the same words as the predicates: `no refs`
      // (AC-68) against `ref outside allowlist: <ref>` (AC-9). The aggregate
      // stays comparable between builds; the distinction stays readable.
      logger?.info(
        { pr_id: prId, dropped_kind: d.kind, reason: d.reason },
        `Brief dropped a ${d.kind}: ${d.title} — ${d.reason}`,
      );
    }

    // EVERY GROUNDED FOCUS ITEM IS PERSISTED — no server-side ceiling.
    //
    // A `slice(0, 10)` used to stand here and it was a quiet requirements bug:
    // AC-40 ("at most ten") and AC-41 ("the real count, when there are more")
    // are both CLIENT criteria about rendering, and truncating on the way into
    // the row leaves AC-41 with nothing to count — the card cannot say "10 of
    // 17" about a list that arrived as 10 of 10. The alternative, keeping the
    // cut and adding a `review_focus_total` column plus a contract field, buys
    // nothing the full array does not already carry.
    const reviewFocus = grounded.reviewFocus;

    const row = await this.repo.upsert({
      prId: pull.id,
      what: result.data.what,
      why: result.data.why,
      // THE MODEL'S HEADLINE SURVIVES ITS RISKS (AC-12). Dropping every risk
      // does not make a PR safe; it makes our evidence for the level thin, and
      // `risks_grounded: false` is how that is said.
      riskLevel: result.data.risk_level,
      risks: grounded.risks,
      reviewFocus,
      risksGrounded: grounded.risksGrounded,
      droppedBlocks: fit.dropped,
      unavailableInputs: fit.input.unavailableInputs,
      headSha: pull.headSha,
      provider,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      // null = UNKNOWN, never flattened to 0, which would read as "free".
      costUsd: result.costUsd,
      attempts: result.attempts,
    });

    logger?.info(
      {
        pr_id: prId,
        attempts: result.attempts,
        tokens_in: result.tokensIn,
        tokens_out: result.tokensOut,
        cost_usd: result.costUsd,
      },
      `Brief built (risk=${row.riskLevel}, ${row.risks.length} risk(s), ` +
        `${row.reviewFocus.length} focus item(s)) — ` +
        `${result.tokensIn} in / ${result.tokensOut} out` +
        (result.costUsd == null ? ' · cost unknown' : ` · $${result.costUsd.toFixed(6)}`),
    );

    // A build that got here wrote a row; a build that threw earlier — a failed
    // provider call, an over-budget input — never reached the upsert, so the
    // PREVIOUS brief is still whole and still returned by `view` (AC-29). That
    // is a property of there being exactly one write, at the end.
    return { brief: toBriefDto(row), stale: false, reused: false, model_calls: modelCalls };
  }

  /**
   * What the input was made of — kind, ref and SIZE, and nothing else.
   *
   * Deliberately built from the blocks and the unavailable list rather than from
   * the text: a log that quotes a project document or an issue body has put
   * third-party content into an operator's terminal and into whatever ships logs
   * off this machine. URLs go through `redactUrlForLog` for the same reason.
   */
  private logComposition(
    logger: PinoLike | undefined,
    prId: string,
    input: Parameters<typeof renderBriefBlocks>[0],
    tokens: number,
    dropped: string[],
  ): void {
    if (!logger) return;
    const parts = renderBriefBlocks(input).map(
      (b) => `${b.name}(${this.container.tokenizer.count(b.text)}t)`,
    );
    logger.info(
      { pr_id: prId, tokens, budget: BRIEF_TOKEN_BUDGET, dropped },
      `Brief input: ${parts.join(' · ') || 'none'} — ${tokens} tokens` +
        (dropped.length > 0 ? ` · dropped: ${dropped.map(redactUrlForLog).join(', ')}` : ''),
    );
    if (input.unavailableInputs.length > 0) {
      logger.info(
        { pr_id: prId, unavailable: input.unavailableInputs.length },
        `Brief: ${input.unavailableInputs.length} input(s) unavailable — ` +
          input.unavailableInputs.map(redactUrlForLog).join('; '),
      );
    }
  }

  /**
   * Workspace override, else this module's own default.
   *
   * `container.featureModel` returns the OVERRIDE only, so reading its absence
   * rather than a resolved value keeps the built-in documented in one place —
   * next to the note saying it mirrors the `risk_brief` registry entry.
   */
  private async resolveModel(
    workspaceId: string,
  ): Promise<{ provider: Provider; model: string }> {
    const override = await this.container.featureModel(workspaceId, 'risk_brief');
    if (override) return { provider: override.provider, model: override.model };
    return { provider: DEFAULT_BRIEF_PROVIDER, model: DEFAULT_BRIEF_MODEL };
  }

  /**
   * Resolve the PR IN THIS WORKSPACE. Every entry point goes through here first,
   * because `pr_brief` has no `workspace_id` of its own — this lookup IS the
   * tenancy boundary, and a `prId` that reaches the repository without it is a
   * cross-tenant read.
   */
  private async requirePull(workspaceId: string, prId: string): Promise<BriefPull> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return pull;
  }
}

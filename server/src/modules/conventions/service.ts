import type {
  ConventionCandidate,
  ConventionCategory,
  ConventionSkillDraft,
  ConventionStatus,
  ConventionsView,
  Skill,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import {
  ConventionsRepository,
  type InsertCandidate,
  type RepoBasics,
} from './repository.js';
import {
  CONFIG_FAMILIES,
  DEFAULT_EXTRACTION_MODEL,
  DEFAULT_EXTRACTION_PROVIDER,
  EXTRACTION_MAX_TOKENS,
  EXTRACTION_TIMEOUT_MS,
  MAX_CONFIG_BYTES,
  MAX_CONFIG_FILES,
  MAX_PACKAGE_DIRS,
  SAMPLE_FILE_COUNT,
} from './constants.js';
import {
  buildSampleBlock,
  configCandidatePaths,
  packageDirsFrom,
  pickConfigFiles,
  reducePackageJson,
  type SampleInput,
  type SampledFile,
} from './pipeline/samples.js';
import { buildExtractionMessages } from './pipeline/prompt.js';
import {
  CONVENTION_EXTRACTION_SCHEMA_NAME,
  ConventionExtraction,
} from './pipeline/schema.js';
import { normaliseRule, verifyCandidates } from './pipeline/verify.js';
import { buildSkillDraft, toCandidateDto, toScanDto } from './helpers.js';

/**
 * The Conventions Extractor.
 *
 * sample (code) → extract (one cheap model call) → verify (code) → persist.
 *
 * Only the second step involves a model, and its output is treated as a claim
 * rather than as an answer: a candidate that cannot point at code the prompt
 * actually carried is discarded, and the count of discards is written to the
 * scan row. That is the review pipeline's grounding invariant one layer up.
 *
 * Note what the service does NOT do: it never re-reads the clone to check a
 * citation. The files are read once, and both the prompt and the verifier work
 * off the same `SampledFile` map, so a citation is checked against the exact
 * bytes the model received.
 */
export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  /** The page's read: the last scan and its surviving candidates. */
  async view(workspaceId: string, repoId: string): Promise<ConventionsView> {
    await this.requireRepo(workspaceId, repoId);
    const [scan, rows] = await Promise.all([
      this.repo.latestScan(workspaceId, repoId),
      this.repo.listCandidates(workspaceId, repoId),
    ]);
    return {
      scan: scan ? toScanDto(scan) : null,
      candidates: rows.map(toCandidateDto),
    };
  }

  /**
   * Run an extraction. Synchronous: the input is bounded (≤ 15 capped files),
   * the model is a cheap one, and one spinner beats a poll loop. The provider
   * call carries its own `timeoutMs`, so a hung provider fails the request
   * rather than hanging it.
   */
  async extract(workspaceId: string, repoId: string): Promise<ConventionsView> {
    const repo = await this.requireRepo(workspaceId, repoId);
    if (!repo.clonePath) {
      throw new ConflictError('This repo has not been cloned yet.', { code: 'not_cloned' });
    }

    const indexState = await this.container.repoIntel.getIndexState(repoId);
    const ranked = await this.container.repoIntel.getConventionSamples(repoId, SAMPLE_FILE_COUNT);
    if (ranked.length === 0) {
      // No rank means no index (or the flag is off). Sampling "whatever the
      // walker finds first" instead would produce a scan whose file set nobody
      // can explain, which is worse than saying so.
      throw new ConflictError('This repo has not been indexed yet, so there is nothing to sample.', {
        code: 'not_indexed',
      });
    }

    const { inputs, configFiles } = await this.readSamples(repo.clonePath, ranked);
    const block = buildSampleBlock(inputs);

    const { provider, model } = await this.resolveModel(workspaceId);
    const llm = await this.container.llm(provider);
    const result = await llm.completeStructured({
      model,
      schema: ConventionExtraction,
      schemaName: CONVENTION_EXTRACTION_SCHEMA_NAME,
      messages: buildExtractionMessages({
        repoFullName: repo.fullName,
        sampleText: block.text,
      }),
      temperature: 0,
      maxTokens: EXTRACTION_MAX_TOKENS,
      timeoutMs: EXTRACTION_TIMEOUT_MS,
    });

    const { kept, dropped } = verifyCandidates(result.data.candidates, block.sampled);

    // Carry decisions across the re-scan BEFORE the old rows go. Without this,
    // every scan re-proposes what you already rejected — which is the behaviour
    // that gets a suggestion feature switched off.
    const previous = await this.repo.listCandidates(workspaceId, repoId);
    const priorStatus = new Map<string, ConventionStatus>();
    for (const row of previous) {
      if (row.status !== 'pending') {
        priorStatus.set(normaliseRule(row.rule), row.status as ConventionStatus);
      }
    }

    const sampledPaths = [...block.sampled.keys()];
    await this.container.db.transaction(async (tx) => {
      const scan = await this.repo.insertScan(
        {
          workspaceId,
          repoId,
          indexedSha: indexState.lastIndexedSha || 'HEAD',
          sampledFiles: sampledPaths,
          configFiles,
          proposed: result.data.candidates.length,
          kept: kept.length,
          dropped,
          provider,
          model: result.model,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          costUsd: result.costUsd,
        },
        tx,
      );
      await this.repo.deleteCandidatesForRepo(workspaceId, repoId, tx);
      const values: InsertCandidate[] = kept.map((c) => ({
        workspaceId,
        repoId,
        scanId: scan.id,
        category: c.category,
        rule: c.rule,
        evidencePath: c.evidence_path,
        evidenceStartLine: c.evidence_start_line,
        evidenceEndLine: c.evidence_end_line,
        evidenceSnippet: c.evidence_snippet,
        confidence: c.confidence,
        status: priorStatus.get(normaliseRule(c.rule)) ?? 'pending',
      }));
      await this.repo.insertCandidates(values, tx);
    });

    return this.view(workspaceId, repoId);
  }

  /** Accept, reject, or edit one candidate. */
  async patch(
    workspaceId: string,
    id: string,
    patch: { status?: ConventionStatus; rule?: string; category?: ConventionCategory },
  ): Promise<ConventionCandidate> {
    const row = await this.repo.updateCandidate(workspaceId, id, patch);
    if (!row) throw new NotFoundError('Convention candidate not found');
    return toCandidateDto(row);
  }

  /**
   * The merged draft, built from the ACCEPTED candidates only. The modal edits
   * the text it returns; it does not get to decide membership.
   */
  async skillDraft(workspaceId: string, repoId: string): Promise<ConventionSkillDraft> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const accepted = await this.repo.listAccepted(workspaceId, repoId);
    if (accepted.length === 0) {
      throw new ValidationError('Accept at least one convention before creating a skill.');
    }
    const scan = await this.repo.latestScan(workspaceId, repoId);
    return buildSkillDraft(accepted.map(toCandidateDto), {
      repoFullName: repo.fullName,
      sampledCount: scan?.sampledFiles.length ?? accepted.length,
      indexedSha: scan?.indexedSha ?? 'HEAD',
    });
  }

  /**
   * Persist the (possibly edited) draft as a skill and stamp the candidates it
   * came from — one transaction, because a skill whose candidates still read
   * `skill_id: null` would make the "already exported" state a lie.
   *
   * `source: 'extracted'` is the first use of a value the contract has carried
   * since the starter.
   */
  async createSkill(
    workspaceId: string,
    repoId: string,
    draft: ConventionSkillDraft,
  ): Promise<Skill> {
    await this.requireRepo(workspaceId, repoId);
    const accepted = await this.repo.listAccepted(workspaceId, repoId);
    if (accepted.length === 0) {
      throw new ValidationError('Accept at least one convention before creating a skill.');
    }

    // Trust the server's own accepted set, not the ids the client echoed back.
    // A client that kept a stale draft would otherwise stamp a candidate that
    // has since been rejected.
    const ids = accepted.map((row) => row.id);

    return this.container.db.transaction(async (tx) => {
      const skill = await this.container.skills.create(
        workspaceId,
        {
          name: draft.name,
          description: draft.description,
          type: draft.type,
          body: draft.body,
          source: 'extracted',
          enabled: draft.enabled,
        },
        tx,
      );
      await this.repo.setSkillId(workspaceId, ids, skill.id, tx);
      return skill;
    });
  }

  // -------------------------------------------------------------------------

  private async requireRepo(workspaceId: string, repoId: string): Promise<RepoBasics> {
    const repo = await this.repo.getRepoBasics(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  /**
   * Read the config allowlist and the ranked files through the `SourceReader`
   * port. Config candidates are simply read: a miss answers `null`, which is the
   * same thing as "this repo has no prettier config".
   */
  private async readSamples(
    clonePath: string,
    ranked: string[],
  ): Promise<{ inputs: SampleInput[]; configFiles: string[] }> {
    const reader = this.container.sourceReader;
    // Root AND the package dirs the ranked files name. Root-only missed every
    // config in a repo of standalone packages — see CONFIG_FAMILIES.
    const packageDirs = packageDirsFrom(ranked, MAX_PACKAGE_DIRS);
    const candidates = configCandidatePaths(CONFIG_FAMILIES, packageDirs);
    const rawConfigs = await Promise.all(
      candidates.map(async (path) => ({ path, content: await reader.read(clonePath, path) })),
    );
    const present = new Set(rawConfigs.filter((c) => c.content !== null).map((c) => c.path));
    const byPath = new Map(rawConfigs.map((c) => [c.path, c.content]));

    const inputs: SampleInput[] = [];
    const configFiles: string[] = [];
    for (const path of pickConfigFiles(CONFIG_FAMILIES, present, packageDirs, MAX_CONFIG_FILES)) {
      const raw = byPath.get(path);
      if (raw == null) continue;
      // `endsWith`, not `===`: `server/package.json` needs reducing just as much
      // as a root one, and it is the only kind this repo has.
      const content = path.endsWith('package.json') ? reducePackageJson(raw) : raw;
      // An unparseable package.json costs one sample rather than a bad one.
      if (content == null) continue;
      inputs.push({ path, content, maxBytes: MAX_CONFIG_BYTES });
      configFiles.push(path);
    }

    // Configs first: they are small, rule-dense, and the ones worth keeping when
    // the total budget runs out.
    for (const path of ranked) {
      const content = await reader.read(clonePath, path);
      // A path the index still lists but the clone no longer has — stale index,
      // not an error. It simply never reaches the prompt, which is why no
      // candidate can ever cite it.
      if (content == null) continue;
      inputs.push({ path, content });
    }

    return { inputs, configFiles };
  }

  /**
   * The workspace's override, else this module's OWN cheap default.
   *
   * Deliberately not `resolveFeatureModel`: that falls back to the registry
   * default for `conventions`, which is a frontier model. Extraction is a
   * bulk-read task over ~15 files and runs on every re-scan, so its unconfigured
   * cost has to be small. `feature-models.ts` reserves exactly this path for
   * "callers that keep their own dynamic default (e.g. conventions)".
   */
  private async resolveModel(
    workspaceId: string,
  ): Promise<{ provider: 'openai' | 'anthropic' | 'openrouter'; model: string }> {
    const override = await this.container.featureModel(workspaceId, 'conventions');
    if (override) return { provider: override.provider, model: override.model };
    return { provider: DEFAULT_EXTRACTION_PROVIDER, model: DEFAULT_EXTRACTION_MODEL };
  }
}

// Re-exported for the tests that build a `SampledFile` fixture.
export type { SampledFile };

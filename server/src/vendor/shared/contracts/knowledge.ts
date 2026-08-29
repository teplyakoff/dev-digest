import { z } from 'zod';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSection = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(), // markdown
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
});
export type Onboarding = z.infer<typeof Onboarding>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

/**
 * The metrics of one eval execution.
 *
 * `recall`, `precision` and `citation_accuracy` are `.nullable()` — NOT
 * `.optional()`. The distinction is load-bearing: a metric whose denominator is
 * zero (no expected findings, or no findings at all) is *present and explicitly
 * unknown*, and `null` is the only value that says so. `0` would claim "found
 * nothing it should have", `1` would claim "perfect"; both are wrong answers to
 * `0/0`, and `undefined` would make the key droppable in JSON, which loses the
 * distinction on the wire. Consumers must branch on `null` and render "—".
 */
export const EvalRun = z.object({
  recall: z.number().min(0).max(1).nullable(),
  precision: z.number().min(0).max(1).nullable(),
  citation_accuracy: z.number().min(0).max(1).nullable(),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

// Where a skill's text came from. 'imported_file' is an upload (markdown or an
// archive) that went through the import preview — neither a URL fetch nor the
// community catalog, and the only source that lands `enabled: false`.
export const SkillSource = z.enum([
  'manual',
  'imported_url',
  'imported_file',
  'extracted',
  'community',
]);
export type SkillSource = z.infer<typeof SkillSource>;

/**
 * A skill name is the block heading the model reads, the label in the run trace,
 * and what a person types when they talk about it — so it is a slug, unique per
 * workspace (see the unique index in migration 0012), not free text.
 */
export const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
export const SkillName = z
  .string()
  .min(2)
  .max(64)
  .regex(SKILL_NAME_PATTERN, 'lowercase letters, digits and hyphens; must start alphanumeric');

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
  /**
   * How many agents in this workspace link the skill. **List endpoint only** —
   * denormalized on read by `GET /skills`, exactly like `PrMeta.cost_usd`. Absent
   * on single-skill reads and on create/update responses; the card renders the
   * footer only when it is present, so "not loaded" and "zero agents" stay
   * distinguishable. `GET /skills/:id/agents` is the detailed answer.
   */
  used_by: z.number().int().nullish(),
});
export type Skill = z.infer<typeof Skill>;

/** One immutable snapshot of a skill's body, written on every body change. */
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

/** An agent that loads this skill — the card's "N agents" and the delete warning. */
export const SkillUsage = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
});
export type SkillUsage = z.infer<typeof SkillUsage>;

/**
 * What one skill has actually cost and where it is loaded — `GET /skills/:id/stats`.
 *
 * Every number here is READ BACK from persisted run traces, never modelled: a
 * run counts only if its trace records this skill in `config.skills`, and the
 * tokens are the ones the trace already attributed to the rendered block. The
 * design's Stats tab also shows pull-frequency and accept-rate; both are absent
 * on purpose, because nothing in the schema links a finding back to the skill
 * that provoked it, and a plausible number is worse than none.
 *
 * Runs are matched by skill NAME, which is what a trace stores. Names are unique
 * per workspace, so the match is unambiguous — but RENAMING a skill orphans the
 * runs made under its old name, and `runs` drops accordingly. That is the honest
 * reading: those runs really did load a differently-named block.
 */
export const SkillStats = z.object({
  /** Agents that link the skill right now — the same list as `/skills/:id/agents`. */
  agents: z.array(SkillUsage),
  /** Runs whose trace loaded this skill. */
  runs: z.number().int(),
  /** Tokens the rendered block added, summed across those runs. */
  tokens_total: z.number().int(),
  /** Mean tokens per run that loaded it; 0 when `runs` is 0. */
  tokens_avg: z.number().int(),
  /** ISO timestamp of the most recent run that loaded it; null if never. */
  last_loaded_at: z.string().nullable(),
});
export type SkillStats = z.infer<typeof SkillStats>;

/**
 * The result of parsing an uploaded skill. Returned by `POST /skills/import/preview`
 * and echoed back to `/confirm`. NOTHING here has been written yet — the preview
 * is the mandatory human gate before someone else's instructions enter an
 * agent's prompt.
 */
export const SkillImportPreview = z.object({
  name: SkillName,
  description: z.string(),
  type: SkillType,
  body: z.string(),
  source: z.literal('imported_file'),
  origin: z.object({
    filename: z.string(),
    kind: z.enum(['markdown', 'archive']),
    bytes: z.number().int(),
  }),
  /** Which entry inside the archive became the body; null for a bare .md. */
  entry_path: z.string().nullable(),
  /**
   * Every archive entry the importer refused to open, and why. This is the audit
   * trail for "executable parts are ignored" — the UI renders it verbatim, so it
   * is evidence rather than reassurance.
   */
  ignored: z.array(z.object({ path: z.string(), reason: z.string() })),
  /** Frontmatter keys honoured (name/description/type) vs dropped. */
  frontmatter: z.object({
    used: z.array(z.string()),
    dropped: z.array(z.string()),
  }),
  warnings: z.array(z.string()),
});
export type SkillImportPreview = z.infer<typeof SkillImportPreview>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// The Conventions block used to sit here. It moved to the bottom of the file
// because `ConventionScan.provider` reuses the `Provider` enum declared below —
// a Zod object literal evaluates on import, so referring to `Provider` from
// above it is a temporal-dead-zone crash at module load, not a type error.

// ---- Agents ----
// 'openrouter' routes through the OpenAI-compatible API (OpenAIProvider with a
// custom baseURL) — used by the CI runner for cheap models (DeepSeek/GLM/MiniMax).
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a review should BLOCK (REQUEST_CHANGES + fail the check)
// vs just comment. Deterministic from finding severities, NOT the model's verdict:
//  - never:    never block, always comment (advisory only)
//  - critical: block iff >=1 CRITICAL finding (default)
//  - warning:  block iff >=1 WARNING or CRITICAL finding
//  - any:      block iff >=1 finding of any severity
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
  /**
   * How many skills this agent links. **List endpoint only** — denormalized on
   * read by `GET /agents`, the mirror image of `Skill.used_by`. Absent on single
   * -agent reads and on create/update responses, so the card can tell "not
   * loaded" from "zero skills" and render the badge only for the latter.
   *
   * Counts LINKS, not what a run would load: `run-executor` additionally drops
   * skills whose master switch is off, so an agent can show 3 here and send 0 to
   * the model. That is deliberate — this number matches the editor's Skills tab,
   * which lists the same three rows with their own toggles.
   */
  skills_count: z.number().int().nullish(),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

// The immutable config snapshot captured in `agent_versions` whenever an agent's
// config changes (everything but `enabled`). Mirrors the shape written by the
// agents repository — provider/model/prompt/output_schema/strategy/gate/repo_intel
// plus the ordered skill ids linked at snapshot time. Used for reproducibility
// (eval replays a past version) and for surfacing an agent's edit history.
export const AgentVersionConfig = z.object({
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  strategy: ReviewStrategy,
  ci_fail_on: CiFailOn,
  repo_intel: z.boolean(),
  skills: z.array(z.string()),
});
export type AgentVersionConfig = z.infer<typeof AgentVersionConfig>;

export const AgentVersion = z.object({
  agent_id: z.string(),
  version: z.number().int(),
  config: AgentVersionConfig,
  created_at: z.string(),
});
export type AgentVersion = z.infer<typeof AgentVersion>;

// ---- Conventions ----
/**
 * The Conventions Extractor: sample the repo with code, ask a cheap model for
 * candidate house-rules, then DROP every candidate that cannot point at real
 * code. That last step is the review pipeline's own grounding invariant applied
 * one layer up — a finding that doesn't cite a real diff line is dropped; a
 * convention that doesn't cite a real file+line is dropped.
 *
 * Placed after the Agents block on purpose — see the note where this section
 * used to live.
 */

export const ConventionCategory = z.enum([
  'naming',
  'structure',
  'error-handling',
  'typing',
  'testing',
  'api',
  'imports',
  'logging',
  'other',
]);
export type ConventionCategory = z.infer<typeof ConventionCategory>;

/**
 * `pending` is not a formality: "a rejected candidate never reaches the skill"
 * is the claim this feature is judged on, and a boolean cannot tell a rejection
 * from a candidate nobody has looked at yet.
 */
export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

/**
 * Why a proposed candidate was thrown away. Recorded per scan, never swallowed.
 *
 * There is deliberately no `file_missing`: verification runs against the exact
 * set of files the prompt carried, so "we cannot find that file" has only one
 * shape — the model named something it was never shown. A file that failed to
 * read never entered the prompt, so no candidate can cite it.
 */
export const ConventionDropReason = z.enum([
  'file_not_sampled', // cited a file the model was never shown
  'line_out_of_range', // start/end outside the lines we actually sent
  'empty_snippet', // the cited span is blank
  'duplicate_rule', // same normalized rule as an earlier candidate
]);
export type ConventionDropReason = z.infer<typeof ConventionDropReason>;

/**
 * REPLACES the starter's `ConventionCandidate` (`accepted: boolean`, no line
 * numbers, nothing that pinned the snippet to real code). Nothing consumed the
 * old shape, so no caller had to migrate — but this IS a breaking contract
 * change, and the API Contract Reviewer is expected to say so on the very PR
 * that introduces it.
 */
export const ConventionCandidate = z.object({
  id: z.string(),
  category: ConventionCategory,
  rule: z.string(),
  evidence_path: z.string(),
  evidence_start_line: z.number().int().positive(),
  evidence_end_line: z.number().int().positive(),
  /**
   * Read from the clone at those lines — NEVER model-authored. The extraction
   * schema has no field for a model-written snippet, so a fabricated one is
   * unrepresentable rather than merely unlikely, and this text always matches
   * what the evidence link resolves to on GitHub.
   */
  evidence_snippet: z.string(),
  confidence: z.number().min(0).max(1),
  status: ConventionStatus,
  /** Set once the candidate has been merged into a skill. */
  skill_id: z.string().nullable(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

/** One extraction run. `proposed` vs `kept` is the per-scan hallucination rate. */
export const ConventionScan = z.object({
  id: z.string(),
  repo_id: z.string(),
  /** The SHA the samples were read at; every evidence permalink pins to it. */
  indexed_sha: z.string(),
  sampled_files: z.array(z.string()),
  config_files: z.array(z.string()),
  proposed: z.number().int(),
  kept: z.number().int(),
  dropped: z.array(z.object({ rule: z.string(), reason: ConventionDropReason })),
  provider: Provider,
  model: z.string(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  /** NULL means UNKNOWN, 0 means free. Never collapse the two. */
  cost_usd: z.number().nullable(),
  created_at: z.string(),
});
export type ConventionScan = z.infer<typeof ConventionScan>;

/** What the Conventions page reads: the last scan (or none yet) and its survivors. */
export const ConventionsView = z.object({
  scan: ConventionScan.nullable(),
  candidates: z.array(ConventionCandidate),
});
export type ConventionsView = z.infer<typeof ConventionsView>;

/**
 * The merged skill, built SERVER-side from the accepted candidates only. The
 * create-skill modal edits this text; it does not decide membership, which is
 * what keeps "rejected candidates never reach the skill" a single server-side
 * assertion instead of a client invariant nobody can test.
 */
export const ConventionSkillDraft = z.object({
  name: SkillName,
  /**
   * `.min(1)` on both text fields because this schema is not only a response —
   * it is the REQUEST body of `POST /repos/:id/conventions/skill`, which is a
   * second way into skill creation. Without them that route accepted an empty
   * body and an empty description where `POST /skills` (`CreateSkillBody`)
   * answers 422, and the row landed `enabled: true` — an empty block rendered
   * into every linked agent's prompt, indistinguishable in the UI from a skill
   * that is merely broken.
   *
   * Keep these in step with `CreateSkillBody` in `modules/skills/routes.ts`.
   * Two doors to one write must not validate differently.
   */
  description: z.string().min(1),
  type: SkillType,
  enabled: z.boolean(),
  body: z.string().min(1),
  candidate_ids: z.array(z.string()),
});
export type ConventionSkillDraft = z.infer<typeof ConventionSkillDraft>;

import { z } from 'zod';
import { FindingCategory, Severity } from '@devdigest/shared';
import type { ToolResult } from '../api/types.js';
import type { Deps } from '../deps.js';
import { applyCharacterLimit, clamp, lineRef, textResult, untrusted } from '../format.js';
import { collectFindings } from '../usecases/collect-findings.js';
import { failure, type ToolDescriptor } from './types.js';

/** Flat and `.strict()`: no nested objects, so the generated JSON Schema has no `$defs`. */
export const GetFindingsInput = z
  .object({
    pull_request: z
      .string()
      .min(1)
      .describe('PR: a GitHub URL, `owner/repo#123`, or the pull-request UUID.'),
    severity: Severity.optional().describe('Keep only this severity.'),
    category: FindingCategory.optional().describe('Keep only this category.'),
    path_contains: z.string().min(1).optional().describe('Keep findings whose file path contains this.'),
    status: z
      .enum(['open', 'accepted', 'dismissed', 'all'])
      .default('open')
      .describe('Action state. Default open = neither accepted nor dismissed.'),
    all_runs: z
      .boolean()
      .default(false)
      .describe('Include superseded runs. Default false = each agent’s newest run only.'),
    limit: z.number().int().min(1).max(100).default(20).describe('Max findings returned.'),
    offset: z.number().int().min(0).default(0).describe('Skip this many matches first.'),
    response_format: z
      .enum(['concise', 'detailed'])
      .default('concise')
      .describe('concise = one line each. detailed adds rationale and suggestion.'),
  })
  .strict();

export const getFindings: ToolDescriptor = {
  name: 'get_findings',
  config: {
    title: 'Read a pull request’s review findings',
    description: [
      'Read the findings DevDigest agents recorded for one pull request, across every agent that',
      'reviewed it, filterable by severity, category, file path and accept/dismiss state.',
      'Use it after run_agent_on_pull_request, or on any PR already reviewed.',
      'It does NOT trigger a review and does NOT accept or dismiss anything.',
      'Examples: get_findings({ pull_request: "acme/api#482" }) → open findings, one line each.',
      'get_findings({ pull_request: "…", severity: "CRITICAL", response_format: "detailed" }).',
    ].join('\n'),
    inputSchema: GetFindingsInput,
    // Deliberately NO outputSchema: `Finding` is 12 fields plus two arrays, and
    // declaring it would cost ~400 tokens in every session for a shape the model
    // reads perfectly well as text.
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  },

  async handler(raw, deps, extra): Promise<ToolResult> {
    try {
      const input = GetFindingsInput.parse(raw ?? {});
      return await run(input, deps, extra.signal);
    } catch (err) {
      return failure(err);
    }
  },
};

async function run(
  input: z.infer<typeof GetFindingsInput>,
  deps: Deps,
  signal: AbortSignal,
): Promise<ToolResult> {
  const page = await collectFindings(
    {
      pullRequest: input.pull_request,
      severity: input.severity,
      category: input.category,
      pathContains: input.path_contains,
      status: input.status,
      limit: input.limit,
      offset: input.offset,
      allRuns: input.all_runs,
    },
    deps.api,
    deps.resolver,
    signal,
  );

  /*
   * Whenever a superseded run was left out, say so in the same breath as the
   * number it was left out of. A total that quietly shrank is indistinguishable
   * from an agent that found less, and this is the tool a model reaches for to
   * decide whether a pull request is clean.
   */
  const hidden =
    page.hiddenRuns > 0
      ? ` Newest run per agent — ${page.hiddenRuns} superseded review row(s) not counted; ` +
        'pass all_runs: true for the full history.'
      : '';

  if (page.total === 0) {
    if (page.agents.length === 0) {
      return textResult(
        `${page.label}: no findings recorded. Nothing has reviewed this pull request yet — ` +
          'run run_agent_on_pull_request first.',
      );
    }
    // Reviewed, and clean — which is a different answer from "never reviewed",
    // and more different still when older runs are sitting behind `all_runs`.
    return textResult(
      `${page.label}: ${page.agents.length} agent(s) reviewed it and recorded no findings ` +
        `(${page.agents.join(', ')}).${hidden}`,
    );
  }
  if (page.matched === 0) {
    return textResult(
      `${page.label}: ${page.total} finding(s) across ${page.agents.length} agent(s), but none match ` +
        `the filters (status=${input.status}` +
        `${input.severity ? `, severity=${input.severity}` : ''}` +
        `${input.category ? `, category=${input.category}` : ''}` +
        `${input.path_contains ? `, path_contains=${input.path_contains}` : ''}). ` +
        `Try status: "all".${hidden}`,
    );
  }

  const header =
    `${page.label} — ${page.matched} matching finding(s) of ${page.total} total, from ` +
    `${page.agents.length} agent(s): ${page.agents.join(', ')}. ` +
    `Showing ${page.items.length} from offset ${input.offset}.${hidden}`;

  const body = page.items
    .map((f) => {
      const head = `${f.severity} ${f.category} ${lineRef(f.file, f.start_line, f.end_line)} — ${clamp(f.title, 200)}`;
      const state = f.accepted_at ? ' [accepted]' : f.dismissed_at ? ' [dismissed]' : '';
      if (input.response_format === 'concise') return `${head}${state}`;
      const rationale = `\n  why: ${clamp(f.rationale, 700)}`;
      const suggestion = f.suggestion ? `\n  fix: ${clamp(f.suggestion, 700)}` : '';
      return `${head}${state} (id ${f.id})${rationale}${suggestion}`;
    })
    .join('\n');

  /*
   * ONE untrusted block around the whole list rather than one per finding: the
   * delimiter is paid once, and `wrapUntrusted` neutralises any `</untrusted>`
   * inside regardless of how many findings it spans. Titles and rationales are
   * model output about somebody else's diff — data for the reading model, never
   * instructions to it. See `format.ts`.
   */
  return textResult(
    applyCharacterLimit(
      `${header}\n${untrusted('pull-request-findings', body)}`,
      'lower `limit`, set `severity: "CRITICAL"`, set `path_contains`, or use `response_format: "concise"`',
    ),
  );
}

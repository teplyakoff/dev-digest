import { z } from 'zod';
import { ConventionCategory, ConventionStatus } from '@devdigest/shared';
import type { ToolResult } from '../api/types.js';
import type { Deps } from '../deps.js';
import { applyCharacterLimit, clamp, lineRef, textResult, untrusted } from '../format.js';
import { readConventions } from '../usecases/read-conventions.js';
import { failure, type ToolDescriptor } from './types.js';

export const GetConventionsInput = z
  .object({
    repo: z.string().min(1).describe('Repository: a GitHub URL, `owner/repo`, or the repo UUID.'),
    status: z
      .union([ConventionStatus, z.literal('all')])
      .default('accepted')
      .describe('accepted (default), pending, rejected, or all.'),
    category: ConventionCategory.optional().describe('Keep only this category.'),
    limit: z.number().int().min(1).max(100).default(25).describe('Max conventions returned.'),
    offset: z.number().int().min(0).default(0).describe('Skip this many matches first.'),
    include_skill_draft: z
      .boolean()
      .default(false)
      .describe('Append the merged skill body. Long — it is the full text sent to agents.'),
  })
  .strict();

export const getConventions: ToolDescriptor = {
  name: 'get_conventions',
  config: {
    title: 'Read a repository’s extracted conventions',
    description: [
      'Read the coding conventions DevDigest extracted from a repository, each with the file and',
      'lines it was inferred from. Accepted ones are what review agents are told to enforce.',
      'Use it to match existing style before writing code, or to see why a finding was raised.',
      'It does NOT run the extractor and does NOT accept, reject or edit a convention.',
      'Examples: get_conventions({ repo: "acme/api" }) → accepted rules.',
      'get_conventions({ repo: "acme/api", status: "pending", category: "testing" }).',
    ].join('\n'),
    inputSchema: GetConventionsInput,
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  },

  async handler(raw, deps, extra): Promise<ToolResult> {
    try {
      const input = GetConventionsInput.parse(raw ?? {});
      return await run(input, deps, extra.signal);
    } catch (err) {
      return failure(err);
    }
  },
};

async function run(
  input: z.infer<typeof GetConventionsInput>,
  deps: Deps,
  signal: AbortSignal,
): Promise<ToolResult> {
  const page = await readConventions(
    {
      repo: input.repo,
      status: input.status,
      category: input.category,
      limit: input.limit,
      offset: input.offset,
      includeSkillDraft: input.include_skill_draft,
    },
    deps.api,
    deps.resolver,
    signal,
  );

  /*
   * `scan: null` means the extractor has NEVER RUN for this repo. Rendering
   * that as "no conventions" would be a lie with the same shape as the truth —
   * so it gets its own message, naming the endpoint that changes the state.
   */
  if (!page.scan) {
    return textResult(
      `${page.label}: the conventions extractor has never run here, so there is nothing to read — ` +
        'this is NOT the same as "this repository has no conventions". Run it from the DevDigest UI, ' +
        `or POST /repos/<id>/conventions/extract against the API.`,
    );
  }

  if (page.matched === 0) {
    return textResult(
      `${page.label}: the last extraction proposed ${page.scan.proposed} and kept ${page.scan.kept}, ` +
        `but none match (status=${input.status}${input.category ? `, category=${input.category}` : ''}). ` +
        'Try status: "all".',
    );
  }

  const header =
    `${page.label} — ${page.matched} convention(s) of ${page.total}, showing ${page.items.length} ` +
    `from offset ${input.offset}. Last extraction: ${page.scan.kept} kept of ${page.scan.proposed} ` +
    `proposed at ${page.scan.indexed_sha.slice(0, 7)}.`;

  const body = page.items
    .map(
      (c) =>
        `${c.category} [${c.status}] ${clamp(c.rule, 300)}\n  evidence: ` +
        `${lineRef(c.evidence_path, c.evidence_start_line, c.evidence_end_line)} — ${clamp(c.evidence_snippet, 240)}`,
    )
    .join('\n');

  const draft = page.skillDraftBody
    ? `\n\nMerged skill body (accepted candidates only):\n${untrusted('convention-skill-draft', page.skillDraftBody)}`
    : '';

  // Rules are model output over repository files, and evidence snippets are the
  // repository's own source. Neither was written by this user.
  return textResult(
    applyCharacterLimit(
      `${header}\n${untrusted('repository-conventions', body)}${draft}`,
      'lower `limit`, set `category`, or drop `include_skill_draft`',
    ),
  );
}

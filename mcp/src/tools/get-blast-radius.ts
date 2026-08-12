import { z } from 'zod';
import { textResult } from '../format.js';
import { failure, type ToolDescriptor } from './types.js';

export const GetBlastRadiusInput = z
  .object({
    repo: z.string().min(1).describe('Repository: a GitHub URL, `owner/repo`, or the repo UUID.'),
    path: z.string().min(1).describe('File whose dependents you want.'),
  })
  .strict();

/**
 * An HONEST stub, and registered rather than hidden — a tool that is visibly
 * unimplemented reports its own absence; one that is missing is indistinguishable
 * from a caller that never thought to ask.
 *
 * ## Why there is nothing to call (verified 2026-08-11)
 *
 * The facade exists: `RepoIntel.getBlastRadius` is declared at
 * `server/src/modules/repo-intel/types.ts:147`, implemented at
 * `service.ts:229`, and its result contract `BlastResult` is at `types.ts:74`.
 * But `server/src/modules/repo-intel/routes.ts` registers exactly two routes —
 * `/repos/:id/index-state` and `/repos/:id/resync`. There is **no HTTP endpoint
 * for blast radius at all**, so this stub is not a product decision made in
 * preference to calling something; there is nothing to call.
 *
 * This handler therefore does NOT reach for `repoIntel`, and invents nothing —
 * a plausible fabricated dependent list is worse than an error, because it looks
 * like an answer.
 *
 * Implementing it for real is a two-part change in a later lesson: add the route
 * on the server, then replace this body. Both, in that order.
 */
export const getBlastRadius: ToolDescriptor = {
  name: 'get_blast_radius',
  config: {
    title: 'Blast radius of a file (not implemented)',
    description: [
      'NOT IMPLEMENTED — always returns an error, and is listed so you can see that it exists.',
      'It will one day report which symbols and files depend on a changed file.',
      'The DevDigest API exposes no blast-radius endpoint yet, so there is nothing to call.',
      'Use get_findings for what a review actually said about a file.',
    ].join('\n'),
    inputSchema: GetBlastRadiusInput,
    annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  },

  async handler(raw) {
    try {
      const input = GetBlastRadiusInput.parse(raw ?? {});
      return textResult(
        `get_blast_radius is not implemented. Nothing was computed for \`${input.path}\` in ${input.repo}, ` +
          'and no partial or approximate answer is being offered.\n\n' +
          'Why: DevDigest indexes repository symbols, but the API exposes no HTTP endpoint for blast radius ' +
          '(`repo-intel` registers only /repos/:id/index-state and /repos/:id/resync). This is a known ' +
          'extension point, not a transient failure — retrying will not help.\n\n' +
          'Available instead: get_findings(pull_request, path_contains) for what the reviewers said about ' +
          'this file, and get_conventions(repo) for the rules it is expected to follow.',
        true,
      );
    } catch (err) {
      return failure(err);
    }
  },
};

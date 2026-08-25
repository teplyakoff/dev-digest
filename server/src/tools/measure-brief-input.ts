import 'dotenv/config';
import { createDb } from '../db/client.js';
import { loadConfig } from '../platform/config.js';
import { Container } from '../platform/container.js';
import { collectBriefInput, renderBriefBlocks } from '../modules/brief/pipeline/sources.js';
import { assembleBriefMessages } from '../modules/brief/pipeline/prompt.js';
import { fitToBudget, BriefInputTooLargeError } from '../modules/brief/pipeline/budget.js';
import { BRIEF_TOKEN_BUDGET } from '../modules/brief/constants.js';

/**
 * `pnpm measure:brief --pr <uuid> [--pr <uuid> …]` — what a brief's input really
 * weighs, on real pull requests.
 *
 * WHY THIS EXISTS AS A STEP RATHER THAN AN ESTIMATE. `server/INSIGHTS.md`
 * (2026-08-06) records a threshold armed on fixtures alone that fired ZERO times
 * against three real PRs, because a fixture chooses its own inputs: it never
 * contains a 64 kB project-context document, a 291-file diff or a PR body with a
 * marketing footer. NFR-1's 8 000 is a requirement, and a requirement that has
 * never met production data is a guess with a number on it.
 *
 * TRANSPORT, NOT A BACK DOOR (onion §9). A CLI is a driving adapter like an HTTP
 * route: it calls the same use case (`collectBriefInput`) and the same pure rules
 * (`assembleBriefMessages`, `fitToBudget`) the service calls, and reaches past
 * neither into a repository. That is also what makes the number it prints
 * meaningful — it is the number the service would have sent, not a re-derivation
 * of it.
 *
 * NO MODEL CALL, AND NO OTHER MODE. Nothing here resolves `container.llm`. The
 * intent is READ, never derived (`collectBriefInput` only derives when a caller
 * hands it a record), so running this costs zero tokens and zero dollars. It does
 * make one GitHub read per PR that links an issue — the same read the build
 * makes, which is the point.
 */

/**
 * This program's OUTPUT, which is its whole product — not logging.
 *
 * `process.stdout.write` rather than `console.log` on purpose, and the reason is
 * worth stating: `no-console` and the `debug-leftovers` gate both exist to catch
 * a stray debug print left in shipped source, and both identify CLIs by a
 * literal filename list (`seed.ts`, `migrate.ts`) that predates `src/tools/`.
 * Writing to stdout directly is what a report generator does anyway — there is
 * no log level here, and nothing to silence — so this file satisfies the intent
 * of both rules without depending on either list being extended. That the list
 * has not been extended is a real gap and is flagged rather than papered over:
 * the next CLI added under `src/tools/` will hit the same wall.
 */
function out(line = ''): void {
  process.stdout.write(`${line}\n`);
}

interface Args {
  prIds: string[];
  workspaceId?: string;
}

function parseArgs(argv: string[]): Args {
  const prIds: string[] = [];
  let workspaceId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pr' && argv[i + 1]) prIds.push(argv[++i]!);
    else if (argv[i] === '--workspace' && argv[i + 1]) workspaceId = argv[++i]!;
  }
  return { prIds, workspaceId };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

async function main(): Promise<void> {
  const { prIds, workspaceId } = parseArgs(process.argv.slice(2));
  if (prIds.length === 0) {
    console.error('usage: pnpm measure:brief --pr <uuid> [--pr <uuid> …] [--workspace <uuid>]');
    process.exit(2);
  }

  // `loadConfig()` defaults to `process.env` and is the ONE place this
  // service reads the environment (onion §3) — a direct `process.env` here is a
  // lint error, and deliberately so.
  const config = loadConfig();
  const handle = createDb(config.databaseUrl, { max: 2 });
  const container = new Container(config, handle.db);

  // The default workspace, unless told otherwise. `getPull` is workspace-scoped
  // and will simply not find the PR under the wrong one — which is the tenancy
  // boundary doing its job, not a bug in this script.
  const ws =
    workspaceId ??
    (
      await handle.sql<{ id: string }[]>`select id from workspaces order by created_at limit 1`
    )[0]!.id;

  const totals: number[] = [];

  for (const prId of prIds) {
    out(`\n=== PR ${prId} ===`);
    const input = await collectBriefInput(container, ws, prId);
    const blocks = renderBriefBlocks(input);

    out(`${pad('block', 20)}${pad('chars', 10)}tokens`);
    for (const b of blocks) {
      out(
        `${pad(b.name, 20)}${pad(String(b.text.length), 10)}${container.tokenizer.count(b.text)}`,
      );
    }

    // THE NUMBER NFR-1 NORMS: the assembled system + user messages, wrappers,
    // captions, system prompt and guard included. The per-block numbers above
    // do not add up to it, and that gap is the whole reason the budget moved to
    // this unit.
    const messages = assembleBriefMessages(input);
    const total = messages.reduce((n, m) => n + container.tokenizer.count(m.content), 0);
    for (const m of messages) {
      out(`  ${pad(`${m.role} message`, 18)}${container.tokenizer.count(m.content)}`);
    }
    out(`COLLECTED TOTAL: ${total} tokens (budget ${BRIEF_TOKEN_BUDGET})`);

    if (input.unavailableInputs.length > 0) {
      out(`unavailable: ${input.unavailableInputs.join('; ')}`);
    }

    // Which levels would fire on THIS input — the check that levels 4 and 5 are
    // reachable on real data rather than dead code kept alive by a fixture.
    // TWO NUMBERS, NOT ONE, and conflating them is how this tool would start
    // lying. COLLECTED is what the input weighs before any level runs; SENT is
    // what leaves the process, which is the quantity NFR-1 actually norms. They
    // were equal on every PR of this workspace until a real project-context
    // document existed, and they have not been equal since.
    try {
      const fit = fitToBudget(input, assembleBriefMessages, container.tokenizer, BRIEF_TOKEN_BUDGET);
      out(
        fit.dropped.length > 0
          ? `levels that fire: ${fit.dropped.join(' → ')}`
          : 'levels that fire: none — it fits as collected',
      );
      out(`SENT TOTAL: ${fit.tokens} tokens`);
      totals.push(fit.tokens);
    } catch (err) {
      if (err instanceof BriefInputTooLargeError) {
        out(`OVER BUDGET after every level: ${JSON.stringify(err.details)}`);
        // Counted at the budget: a build that refuses is not a build that sent
        // zero tokens, and silently omitting it would flatter the median.
        totals.push(BRIEF_TOKEN_BUDGET);
      } else throw err;
    }
  }

  const sorted = [...totals].sort((a, b) => a - b);
  const median =
    sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]!
      : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  out(`\nSENT totals: ${sorted.join(', ')}`);
  out(`MEDIAN: ${median} tokens · budget ${BRIEF_TOKEN_BUDGET}`);
  // The stop condition is the plan's, and it is judged on what is SENT — the
  // quantity NFR-1 norms — not on what was collected before the levels ran. It
  // belongs to the SPEC either way: a median outside this band means NFR-1's
  // number is wrong, and the measurement goes back to the spec rather than the
  // constant being edited to fit.
  out(
    median >= 4_000 && median <= 16_000
      ? 'within [4 000; 16 000] — the 8 000 budget stands as specified'
      : 'OUTSIDE [4 000; 16 000] — STOP: this is a spec change, not a code change',
  );

  await handle.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

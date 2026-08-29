/**
 * DevDigest screencast recorder — L06: the eval pipeline (SPEC-08).
 *
 * The graded story end to end, in one video:
 *
 *  1. A decided finding on the PR, its Accepted / Dismissed decision on screen.
 *     The decision is the input to everything below: it is what the direction of
 *     the eval case is derived from, server-side.
 *  2. ONE CLICK turns it into an eval case, and the success toast carries the
 *     "Edit case" link itself. No dialog opens — that is the criterion (AC-65),
 *     and it is ASSERTED here rather than filmed, because "a modal did not open"
 *     is invisible on camera when the modal is simply late.
 *  3. The agent's Evals tab: the case list with its MUST FIND / MUST NOT FLAG
 *     direction badges, the new case highlighted by `?case=<id>`, and the metric
 *     strip with the sentence that states the whole scoring claim — "Scoring is
 *     mechanical … No model call in the scorer."
 *  4. Run all evals. The action disables while the batch is in flight, then the
 *     metrics land: recall, precision, citation accuracy.
 *  5. The system prompt is edited on the Config tab and a SECOND batch runs —
 *     the "old prompt vs new" experiment, and the only way the compare screen
 *     has a prompt diff to show. Skipped when a prior batch on the same
 *     provider+model already carries a different snapshot; see `DEMO_EVAL_BATCHES`.
 *  6. The Eval Dashboard at `/eval/:agentId`, reached from the sidebar (SKILLS
 *     LAB → Eval Dashboard, which points at `/eval`), with the agent picked and
 *     the run history under it.
 *  7. Exactly two runs selected, Compare — the four deltas and the word-level
 *     system-prompt diff. This frame is the payoff and the graded artefact.
 *
 * COSTS MONEY. A batch is one billed model call PER CASE, run sequentially, on
 * the agent's own provider/model — so a set of N cases costs N calls per batch,
 * and the two-batch path costs 2 × N. The preflight prints the exact figure it
 * is about to spend BEFORE the browser opens, computed from the real case set.
 * `record:smart-diff` and `record:blast` are the free recorders in this package.
 *
 * WHAT IT ASSERTS, rather than merely filming:
 *   - one click, no modal: `[role="dialog"]` count is 0 after the create, and
 *     the POST answered 201 with a persisted case (AC-65);
 *   - the direction is the SERVER's derivation of the finding's own decision —
 *     accepted → `must_find`, dismissed → `must_not_flag`. A default of
 *     `must_find` would look identical on an accepted finding, which is why the
 *     recorder prefers to seed from whichever decision it can prove;
 *   - the two compared batches carry DIFFERENT `system_prompt_snapshot` values
 *     and the SAME provider+model, so `comparable` is true. Without that pair of
 *     facts the compare screen is a picture of two unrelated numbers;
 *   - `deltas.recall` really is `b.recall − a.recall`, checked against the two
 *     batch rows the compare response itself returns;
 *   - the batch completed at least one case. An all-errored batch renders a
 *     screen full of honest em dashes and proves nothing about the pipeline.
 *
 * WHAT IT WRITES, and what it puts back:
 *   - it CREATES one eval case (that is scene 2, and the feature). The case is
 *     deliberately NOT deleted afterwards: `eval_runs.case_id` is
 *     `ON DELETE CASCADE`, so removing it would tear its rows out of the batch
 *     this take just filmed and measured. A re-take therefore adds one case per
 *     run — delete the extras from the Evals tab if the set matters.
 *   - it EDITS the agent's system prompt on the two-batch path, and restores the
 *     exact original string in `finally`, including after a failure. Restoring
 *     bumps the agent version a second time; the batch snapshots are unaffected,
 *     because a snapshot is taken when the batch starts and never re-read.
 *
 * Prereqs: the dev stack is up (`../scripts/dev.sh`), `npm run setup` has fetched
 * Chromium, the agent's provider key is configured (Settings → API Keys, or
 * `~/.devdigest/secrets.json`), and the target agent ALREADY has at least one
 * eval case — a batch of one case measures nothing, and this recorder seeds one
 * case, not a set. The preflight refuses to launch the browser when any of that
 * is missing, because a recorder that films an error page is worse than one that
 * refuses to start.
 *
 * Env (all optional):
 *   DEMO_BASE_URL         web origin        default http://localhost:3000
 *   DEMO_API_URL          API origin        default http://localhost:3001
 *   DEMO_OUT              output dir        default ./recordings/l06-evals
 *   DEMO_REPO             repo full_name    default acme/payments-api
 *   DEMO_PR               PR number         default 482
 *   DEMO_HEADED           "1" to watch      default headless
 *   DEMO_EVAL_TIMEOUT     ms per batch      default 900000 (15 min)
 *   DEMO_EVAL_BATCHES     auto | 1 | 2      default auto
 *   DEMO_EVAL_PROMPT_DROP substring of the prompt line to remove for run 2;
 *                         default: the first "- " bullet of the prompt
 *
 * Usage:
 *   npm run record:evals
 */
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const API = process.env.DEMO_API_URL ?? "http://localhost:3001";
const OUT = process.env.DEMO_OUT ?? join(HERE, "recordings", "l06-evals");
const REPO_NAME = process.env.DEMO_REPO ?? "acme/payments-api";
const PR_NUMBER = Number(process.env.DEMO_PR ?? 482);
const HEADED = process.env.DEMO_HEADED === "1";
const BATCH_TIMEOUT = Number(process.env.DEMO_EVAL_TIMEOUT ?? 900_000);
const BATCHES_MODE = (process.env.DEMO_EVAL_BATCHES ?? "auto").toLowerCase();
const PROMPT_DROP = process.env.DEMO_EVAL_PROMPT_DROP ?? "";

const VIEWPORT = { width: 1280, height: 720 };
const CAPTION_ID = "__devdigest_caption";
/** How often the batch row is polled while it runs. The UI polls at 4 s. */
const POLL_MS = 5_000;

// ---------------------------------------------------------------------------
// The API shapes this recorder reads. Hand-written rather than imported: `demo`
// has no path alias to the contracts, and every other recorder here does the
// same. Only the fields actually used are declared.
// ---------------------------------------------------------------------------

interface Repo { id: string; full_name: string }
interface Pull { id: string; number: number; title: string }
interface PrFile { path: string; patch: string | null }
interface PrDetail { number: number; title: string; files: PrFile[] }
interface FindingRecord {
  id: string;
  title: string;
  file: string;
  severity: string;
  start_line: number;
  end_line: number;
  accepted_at: string | null;
  dismissed_at: string | null;
}
interface ReviewRecord {
  id: string;
  agent_id: string | null;
  agent_name?: string | null;
  run_id: string | null;
  findings: FindingRecord[];
}
interface Agent {
  id: string;
  name: string;
  provider: "openai" | "anthropic" | "openrouter";
  model: string;
  system_prompt: string;
  version: number;
}
interface SecretsStatus {
  openai: boolean;
  anthropic: boolean;
  openrouter: boolean;
  github: boolean;
}
type Expectation = "must_find" | "must_not_flag";
interface EvalCaseRecord {
  id: string;
  owner_id: string;
  name: string;
  expectation: Expectation;
  source_finding_id: string | null;
}
interface CreateEvalCaseFromFinding {
  case: EvalCaseRecord;
  existing_cases: EvalCaseRecord[];
}
interface EvalBatchRecord {
  id: string;
  agent_id: string;
  agent_version: number;
  system_prompt_snapshot: string | null;
  provider: string;
  model: string;
  status: "running" | "complete" | "partial" | "failed";
  cases_total: number;
  cases_completed: number;
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  cost_usd: number | null;
  partial: boolean;
  started_at: string;
  finished_at: string | null;
}
interface EvalBatchCompare {
  a: EvalBatchRecord;
  b: EvalBatchRecord;
  deltas: {
    recall: number | null;
    precision: number | null;
    citation_accuracy: number | null;
    cost_usd: number | null;
  };
  comparable: boolean;
  prompt_diff_available: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let shotNo = 0;

/**
 * `fetch` against the local API. The path is always built from ids the API
 * itself returned or from a number parsed out of the environment — nothing read
 * off the recorded PAGE is ever put into a request, and nothing here reaches a
 * shell (`security` — A05).
 */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
  });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

function log(msg: string) {
  console.log(`\x1b[36m•\x1b[0m ${msg}`);
}
function warn(msg: string) {
  console.warn(`\x1b[33m!\x1b[0m ${msg}`);
}

/** Escape a value before it becomes part of a `RegExp` (`security` — A05). */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function caption(page: Page, step: number, text: string) {
  log(`${step}. ${text}`);
  await page.evaluate(
    ({ id, label }) => {
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        Object.assign(el.style, {
          position: "fixed",
          left: "0",
          right: "0",
          bottom: "0",
          zIndex: "2147483647",
          padding: "14px 24px",
          font: "600 17px/1.4 ui-sans-serif, -apple-system, Segoe UI, sans-serif",
          color: "#fff",
          background: "linear-gradient(to top, rgba(8,10,14,.96), rgba(8,10,14,.72))",
          borderTop: "1px solid rgba(255,255,255,.14)",
          pointerEvents: "none",
          textAlign: "center",
          letterSpacing: ".01em",
        });
        document.body.appendChild(el);
      }
      el.textContent = label;
    },
    { id: CAPTION_ID, label: `${step}. ${text}` },
  );
}

async function beat(page: Page, step: number, text: string, ms = 2800) {
  await caption(page, step, text);
  await sleep(ms);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(OUT, `${String(++shotNo).padStart(2, "0")}-${name}.png`) });
}

/**
 * Wait, scroll, settle — always before a shot whose caption names something.
 *
 * `scrollIntoViewIfNeeded` only guarantees visibility at the VIEWPORT EDGE, and
 * this recording pins a caption bar to the bottom of the window, so an element
 * parked at that edge ends up behind it. The native `scrollIntoView({block:
 * "center"})` afterwards is what actually frames it, and it scrolls every
 * scrollable ancestor. `page.mouse.wheel()` is not an option: it scrolls
 * whatever is under the cursor, and the cursor starts at (0,0) over the sidebar
 * (`demo/INSIGHTS.md`, 2026-07-31 and 2026-08-25).
 */
async function frame(loc: Locator, timeout = 30_000): Promise<Locator> {
  await loc.waitFor({ timeout });
  await loc.scrollIntoViewIfNeeded();
  await loc.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
  await sleep(700);
  return loc;
}

/** Playwright records WebM; mp4 also plays in QuickTime and Keynote. */
function toMp4(webm: string): string | null {
  const mp4 = webm.replace(/\.webm$/, ".mp4");
  // Arguments as an ARRAY and no shell: nothing here is interpolated into a
  // command line, env-derived path included (`security` — A05).
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-i", webm, "-c:v", "libx264", "-crf", "28", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4],
    { stdio: "ignore" },
  );
  if (r.status === 0) {
    rmSync(webm, { force: true });
    return mp4;
  }
  warn("no system ffmpeg — leaving the .webm as-is");
  return null;
}

/**
 * Clear what a previous take left behind, at the START.
 *
 * Playwright's raw `page@<guid>.webm` only gets renamed on success, and each
 * finished take drops its own `devdigest-evals-<stamp>.mp4` — so the promote
 * step in `docs/results/` matches more than one file and `cp` fails with
 * `Not a directory` (`demo/INSIGHTS.md`, 2026-08-12).
 */
function sweep() {
  for (const f of readdirSync(OUT)) {
    if (/^page@.*\.webm$/.test(f) || /^devdigest-evals-.*\.(webm|mp4)$/.test(f)) {
      rmSync(join(OUT, f), { force: true });
    }
  }
}

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const points = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}pt`);

/**
 * Remove ONE instruction from a system prompt, and return the new text.
 *
 * A bullet is not one line: these prompts wrap, so the continuation lines
 * (indented, no leading `-`) belong to the bullet above them. Dropping the first
 * physical line alone would leave a dangling fragment in the diff view, which
 * reads as corruption rather than as a removed instruction.
 *
 * The default target is the prompt's FIRST `- ` bullet, which every reviewer
 * prompt in this repo has and which is always a real defect-class instruction.
 * `DEMO_EVAL_PROMPT_DROP` overrides it with a substring — that is how the L06
 * experiment removes, say, the secret-detection instruction from the Security
 * Reviewer. A substring that matches nothing is a preflight failure, never a
 * silent no-op: a second batch with an identical snapshot has no diff to film.
 */
function dropInstruction(prompt: string, needle: string): { next: string; removed: string } | null {
  const lines = prompt.split("\n");
  const start = needle
    ? lines.findIndex((l) => l.toLowerCase().includes(needle.toLowerCase()))
    : lines.findIndex((l) => /^-\s+\S/.test(l));
  if (start === -1) return null;

  let end = start + 1;
  while (end < lines.length && /^\s+\S/.test(lines[end]!)) end++;

  const removed = lines.slice(start, end).join("\n");
  const next = [...lines.slice(0, start), ...lines.slice(end)].join("\n");
  return { next, removed };
}

/** Poll the batch row until it stops running. The API is the truth, not the DOM. */
async function waitForBatch(batchId: string): Promise<EvalBatchRecord> {
  const deadline = Date.now() + BATCH_TIMEOUT;
  let last = 0;
  for (;;) {
    const batch = await api<EvalBatchRecord>(`/eval-batches/${batchId}`);
    if (batch.status !== "running") return batch;
    if (batch.cases_completed !== last) {
      last = batch.cases_completed;
      log(`  … ${batch.cases_completed}/${batch.cases_total} cases`);
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Batch ${batchId} was still running after ${Math.round(BATCH_TIMEOUT / 1000)}s ` +
          `(${batch.cases_completed}/${batch.cases_total} cases). The calls it started are billed ` +
          "whether or not this take finished — raise DEMO_EVAL_TIMEOUT rather than re-running.",
      );
    }
    await sleep(POLL_MS);
  }
}

/**
 * Click the run action, capture the batch id off the 202, and wait it out.
 *
 * The id comes from the POST response rather than from "the newest batch
 * afterwards": a stale row from an earlier attempt is otherwise indistinguishable
 * from this one (`demo/INSIGHTS.md`, 2026-07-28).
 */
async function runBatchFrom(page: Page, button: Locator): Promise<EvalBatchRecord> {
  const started = page.waitForResponse(
    (r) => /\/eval-batches$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
    { timeout: 60_000 },
  );
  await button.click();
  const res = await started;
  if (res.status() !== 202) {
    throw new Error(`Starting the batch answered ${res.status()}: ${await res.text()}`);
  }
  const row = (await res.json()) as EvalBatchRecord;
  log(`batch ${row.id.slice(0, 8)} started — ${row.cases_total} case(s), ${row.provider}/${row.model}`);
  return row;
}

// ---------------------------------------------------------------------------

interface Preflight {
  repo: Repo;
  pull: Pull;
  finding: FindingRecord;
  decision: "accepted" | "dismissed";
  expectation: Expectation;
  agent: Agent;
  cases: EvalCaseRecord[];
  /** A finished batch to compare against instead of running a second one. */
  priorBatch: EvalBatchRecord | null;
  twoBatches: boolean;
  /** The prompt edit scene 5 will make — absent on the one-batch path. */
  edit: { next: string; removed: string } | null;
  seedsExistingCase: boolean;
}

/**
 * Everything that can make a scene unfilmable, checked BEFORE the browser opens
 * and before a single model call is billed.
 *
 * The argument here is stronger than in the free recorders: discovering at scene
 * 4 that the provider key is missing means N errored cases, a screen of em
 * dashes, and a take to do again. `record-smart-diff.ts` refuses to launch when
 * its target lacks the data it needs; this one refuses when the target lacks the
 * data, the key, or a set worth running (`demo/INSIGHTS.md`, 2026-08-25).
 */
async function preflight(): Promise<Preflight> {
  let repos: Repo[];
  try {
    repos = await api<Repo[]>("/repos");
  } catch (err) {
    throw new Error(
      `The API at ${API} did not answer (${err instanceof Error ? err.message : String(err)}). ` +
        "Start the stack with ../scripts/dev.sh — nothing below can be filmed without it.",
    );
  }

  const repo = repos.find((r) => r.full_name === REPO_NAME);
  if (!repo) throw new Error(`Repo ${REPO_NAME} is not imported — import it first, or set DEMO_REPO.`);

  const pulls = await api<Pull[]>(`/repos/${repo.id}/pulls`);
  const pull = pulls.find((p) => p.number === PR_NUMBER);
  if (!pull) throw new Error(`PR #${PR_NUMBER} not found in ${REPO_NAME} — set DEMO_PR.`);

  // A case seeded from a finding stores that file's PATCH as its input diff, and
  // the server refuses to create one when the patch is missing (AC-18). Seed
  // data used to carry `patch: null` on every row, which is exactly this 422.
  const detail = await api<PrDetail>(`/pulls/${pull.id}`);
  const patched = new Set(detail.files.filter((f) => f.patch && f.patch.trim().length > 0).map((f) => f.path));
  if (patched.size === 0) {
    throw new Error(
      `Every file on ${REPO_NAME}#${pull.number} has an empty patch, so no finding on it can become a case ` +
        "— the server rejects a case whose diff would assert nothing. Re-import the PR.",
    );
  }

  const reviews = await api<ReviewRecord[]>(`/pulls/${pull.id}/reviews`);
  const decided = reviews.flatMap((rv) =>
    rv.findings
      .filter((f) => (f.accepted_at || f.dismissed_at) && patched.has(f.file) && rv.agent_id)
      .map((f) => ({ finding: f, agentId: rv.agent_id!, agentName: rv.agent_name ?? null })),
  );
  if (decided.length === 0) {
    throw new Error(
      `No finding on ${REPO_NAME}#${pull.number} is BOTH decided and anchored to a file with patch text. ` +
        "Scene 1 is a decided finding and scene 2 turns it into a case — accept or dismiss one first.",
    );
  }

  const agents = await api<Agent[]>("/agents");
  // The owning agent is derived from the finding, never from an env var: the
  // server puts the case on `finding → review → agent`, and running a batch on
  // any other agent would measure a set this case is not in.
  const owning = decided
    .map((d) => ({ ...d, agent: agents.find((a) => a.id === d.agentId) }))
    .filter((d): d is typeof d & { agent: Agent } => !!d.agent);
  if (owning.length === 0) {
    throw new Error("Every decided finding belongs to a review whose agent no longer exists.");
  }

  const agent = owning[0]!.agent;
  const cases = await api<EvalCaseRecord[]>(`/agents/${agent.id}/eval-cases`);
  const seeded = new Set(cases.map((c) => c.source_finding_id).filter(Boolean) as string[]);

  // Prefer this agent's own findings, then an ACCEPTED one (`must_find` is the
  // direction the whole recall story is about), then one no case has been seeded
  // from — so a re-take shows "Eval case created" rather than the
  // already-exists variant.
  const ranked = owning
    .filter((d) => d.agent.id === agent.id)
    .sort((a, b) => {
      const fresh = Number(seeded.has(a.finding.id)) - Number(seeded.has(b.finding.id));
      if (fresh !== 0) return fresh;
      return Number(!a.finding.accepted_at) - Number(!b.finding.accepted_at);
    });
  const picked = ranked[0]!;
  const finding = picked.finding;
  const decision = finding.accepted_at ? "accepted" : "dismissed";
  const expectation: Expectation = finding.accepted_at ? "must_find" : "must_not_flag";
  const seedsExistingCase = seeded.has(finding.id);
  if (seedsExistingCase) {
    warn(
      `Every decided finding on this PR already has a case seeded from it, so scene 2 films the ` +
        `"an eval case already exists" variant of the toast. Delete the extras on the Evals tab to reset it.`,
    );
  }

  // A batch of one case measures nothing: `recall` would be 0 or 1 and the strip
  // would carry a single point. The seeding scene adds ONE case; the set has to
  // exist before it.
  if (cases.length === 0) {
    throw new Error(
      `"${agent.name}" has no eval cases, and this recorder seeds exactly one — a one-case batch is not a ` +
        "measurement. Turn a few decided findings into cases on the agent's Evals tab first " +
        `(${BASE}/agents/${agent.id}?tab=evals).`,
    );
  }
  if (!cases.some((c) => c.expectation === "must_find") || !cases.some((c) => c.expectation === "must_not_flag")) {
    warn(
      "The set carries only one expectation direction, so scene 3 shows one kind of badge. " +
        "Seed a case from a dismissed finding too if both are wanted on camera.",
    );
  }

  // A key, checked as a BOOLEAN — the API never returns a secret's value, and
  // this recorder must never ask for one. Without it every case errors, the
  // batch still costs the round trips, and the take films em dashes.
  const secrets = await api<SecretsStatus>("/settings/secrets-status");
  if (!secrets[agent.provider]) {
    throw new Error(
      `No ${agent.provider} key is configured, so every case in the batch would error. ` +
        "Set it in Settings → API Keys, or in ~/.devdigest/secrets.json (mode 0600). " +
        "The recorder refuses to spend a run it already knows the answer to.",
    );
  }

  const batches = await api<EvalBatchRecord[]>(`/agents/${agent.id}/eval-batches`);
  const running = batches.find((b) => b.status === "running");
  if (running) {
    throw new Error(
      `A batch for "${agent.name}" is already running (${running.id}). The run action is disabled while it is, ` +
        "and a second one answers 409. Wait for it to finish.",
    );
  }

  // The compare screen's payoff is a prompt DIFF, so the two batches must differ
  // in their snapshot and agree on provider+model. A prior batch that already
  // satisfies both saves a whole set of billed calls; when there is none, scene
  // 5 creates the difference by editing the prompt.
  const priorBatch =
    batches.find(
      (b) =>
        b.status !== "running" &&
        b.provider === agent.provider &&
        b.model === agent.model &&
        b.system_prompt_snapshot !== null &&
        b.system_prompt_snapshot !== agent.system_prompt,
    ) ?? null;

  let twoBatches: boolean;
  if (BATCHES_MODE === "1") {
    if (!priorBatch) {
      throw new Error(
        "DEMO_EVAL_BATCHES=1 needs an existing finished batch on the same provider+model whose prompt " +
          `snapshot differs from "${agent.name}"'s current prompt — there is none, so the compare screen ` +
          "would have nothing to diff. Use DEMO_EVAL_BATCHES=2 (it edits the prompt and runs a second set).",
      );
    }
    twoBatches = false;
  } else if (BATCHES_MODE === "2") {
    twoBatches = true;
  } else if (BATCHES_MODE === "auto") {
    twoBatches = !priorBatch;
  } else {
    throw new Error(`DEMO_EVAL_BATCHES must be auto, 1 or 2 — got "${BATCHES_MODE}".`);
  }

  let edit: Preflight["edit"] = null;
  if (twoBatches) {
    edit = dropInstruction(agent.system_prompt, PROMPT_DROP);
    if (!edit) {
      throw new Error(
        PROMPT_DROP
          ? `No line of "${agent.name}"'s system prompt contains "${PROMPT_DROP}", so the second run would ` +
            "snapshot an identical prompt and the diff would be empty. Point DEMO_EVAL_PROMPT_DROP at a line " +
            "that exists."
          : `"${agent.name}"'s system prompt has no "- " bullet to remove. Set DEMO_EVAL_PROMPT_DROP to a ` +
            "substring of the line the experiment should drop.",
      );
    }
    if (!PROMPT_DROP) {
      // The mechanical default picks the first bullet in the file, which on the
      // seeded General Reviewer is a STACK CONTEXT line rather than a
      // defect-class instruction. That still films a real prompt diff, but the
      // L06 experiment wants a line at least two cases depend on — so say which
      // line is about to go, by name, before anything is spent.
      warn(
        `No DEMO_EVAL_PROMPT_DROP set, so run 2 drops the prompt's FIRST bullet: ` +
          `"${edit.removed.split("\n")[0]!.trim().slice(0, 80)}". Set DEMO_EVAL_PROMPT_DROP to target the ` +
          "instruction the experiment is actually about.",
      );
    }
  }

  // The set as it will be at run time: the seeding scene adds one case.
  const setSize = cases.length + 1;
  const calls = setSize * (twoBatches ? 2 : 1);
  log(
    `preflight ✓ ${REPO_NAME}#${pull.number} · ${finding.file} ${decision} → ${expectation} · ` +
      `agent "${agent.name}" (${agent.provider}/${agent.model}) · ${cases.length} case(s) + 1 seeded`,
  );
  log(
    `\x1b[33mTHIS TAKE SPENDS MONEY:\x1b[0m ${twoBatches ? 2 : 1} batch × ${setSize} case(s) = ` +
      `${calls} billed model call(s) on ${agent.provider}/${agent.model}` +
      (priorBatch && !twoBatches ? `, comparing against batch ${priorBatch.id.slice(0, 8)}` : ""),
  );

  return {
    repo,
    pull,
    finding,
    decision,
    expectation,
    agent,
    cases,
    priorBatch,
    twoBatches,
    edit,
    seedsExistingCase,
  };
}

// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(OUT, { recursive: true });
  sweep();

  const pre = await preflight();
  const { agent, finding } = pre;

  // Snapshotted BEFORE anything is touched, so `finally` can put the prompt back
  // exactly as it was — the same rule `record-context.ts` follows for the
  // attachments it borrows. A recording is evidence, not a migration.
  const originalPrompt = agent.system_prompt;
  let promptEdited = false;

  let browser: Browser | undefined;
  let ctx: BrowserContext | undefined;
  let created: EvalCaseRecord | undefined;
  let batchA: EvalBatchRecord | undefined;
  let batchB: EvalBatchRecord | undefined;
  let compare: EvalBatchCompare | undefined;

  try {
    browser = await chromium.launch({ headless: !HEADED });
    ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      recordVideo: { dir: OUT, size: VIEWPORT },
      colorScheme: "dark",
    });
    const page = await ctx.newPage();

    const agentUrl = `${BASE}/agents/${agent.id}`;

    // ---- Scene 1: a decided finding ---------------------------------------

    // `?finding=<id>` is the deep link the Smart Diff click produces: it opens
    // the owning run's accordion and EXPANDS that card, which is what puts the
    // action row — and with it the eval-case button — on screen.
    await page.goto(`${BASE}/repos/${pre.repo.id}/pulls/${pre.pull.number}?tab=findings&finding=${finding.id}`, {
      waitUntil: "networkidle",
    });
    const card = page.locator(`[data-finding-id="${finding.id}"]`);
    await card.waitFor({ timeout: 30_000 });
    // Waited for, not counted: the card's row lands one commit before
    // `expandNonce` opens it, so an immediate count would race the expansion and
    // blame the deep link for a frame it had not painted yet.
    const evalButton = card.getByRole("button", { name: "Turn into eval case" });
    await evalButton.waitFor({ timeout: 20_000 }).catch(() => {
      throw new Error(
        `The card for ${finding.id} is on screen but never expanded — the action row, and the eval-case ` +
          "button with it, only render on an open card.",
      );
    });
    await frame(card);
    await beat(
      page,
      1,
      `A ${pre.decision} finding on ${REPO_NAME}#${pre.pull.number} — ${finding.file}:${finding.start_line}`,
      4600,
    );
    await shot(page, "decided-finding");

    // ---- Scene 2: one click, one case, no modal ----------------------------

    // The caption goes up BEFORE the click: the toast dismisses itself after
    // four seconds (`lib/toast.tsx`), so the shot has to happen inside that
    // window and cannot wait out a `beat`.
    await caption(page, 2, "One click — no dialog, no form: the decision is already the expectation");
    const seedResponse = page.waitForResponse(
      (r) => /\/eval-case$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await evalButton.click();
    const res = await seedResponse;
    if (res.status() !== 201) {
      throw new Error(`Seeding the case answered ${res.status()}: ${await res.text()}`);
    }
    const payload = (await res.json()) as CreateEvalCaseFromFinding;
    created = payload.case;

    // AC-65, asserted rather than filmed. "No modal opened" is invisible on
    // camera — a modal that is merely LATE looks exactly like one that never
    // came, and the design this screen was drawn from had one here.
    const dialogs = await page.locator('[role="dialog"]').count();
    if (dialogs !== 0) {
      throw new Error(`${dialogs} dialog(s) opened on the one-click path — AC-65 says the click alone persists the case.`);
    }
    if (created.expectation !== pre.expectation) {
      throw new Error(
        `The finding is ${pre.decision} and the server derived \`${created.expectation}\`, not ` +
          `\`${pre.expectation}\` — the direction is supposed to BE the decision.`,
      );
    }
    if (created.owner_id !== agent.id) {
      throw new Error(`The case landed on agent ${created.owner_id}, not on "${agent.name}" (${agent.id}).`);
    }

    // The toast carries the link ITSELF, not a sentence about one (AC-66).
    const toast = page.getByRole("status");
    const toastLink = toast.getByRole("link", { name: "Edit case" });
    await toastLink.waitFor({ timeout: 10_000 });
    await shot(page, "eval-case-created");
    log(
      `case ✓ "${created.name}" · ${created.expectation} · seeded from ${finding.id.slice(0, 8)} · ` +
        `no dialog opened · ${payload.existing_cases.length} pre-existing case(s) for this finding`,
    );
    await sleep(1600);

    // ---- Scene 3: the Evals tab, the case list, the badges -----------------

    // The card's own copy of the link, not the toast's: the toast is gone four
    // seconds after it appeared, and a click racing that timer is a flake, not a
    // demonstration. Both `<a>`s carry the same href.
    await beat(page, 3, "The toast links straight to the case — the agent's Evals tab, with it highlighted", 2600);
    await card.getByRole("link", { name: "Edit case" }).click();
    await page.waitForURL(new RegExp(`/agents/${escapeRe(agent.id)}\\?.*case=${escapeRe(created.id)}`), {
      timeout: 30_000,
    });
    await page.waitForLoadState("networkidle");
    const caseRow = page.locator(`[data-case-id="${created.id}"]`);
    await frame(caseRow);
    const badge = pre.expectation === "must_find" ? "MUST FIND" : "MUST NOT FLAG";
    await caseRow.getByText(badge, { exact: true }).waitFor({ timeout: 15_000 });
    await beat(page, 4, `The eval set — every case says what it asserts: ${badge}`, 5000);
    await shot(page, "evals-tab-cases");

    // The sentence that states the scoring claim. Asserted: it is the UI saying
    // the scorer makes no model call, which is the criterion the whole feature
    // rests on, and a silent removal would leave a video that still looks right.
    const note = page.getByText(/No model call in the scorer/i).first();
    await frame(note);
    await beat(page, 5, "Recall / precision / citation — and the scorer that computes them calls no model", 5200);
    await shot(page, "metric-strip");

    // ---- Scene 4: the first batch ------------------------------------------

    const runAll = page.getByRole("button", { name: "Run all evals" });
    await frame(runAll);
    await beat(page, 6, `Run all evals — ${pre.cases.length + 1} cases, one model call each, one at a time`, 3000);
    batchA = await runBatchFrom(page, runAll);

    // The action is driven by `latest_batch.status`, so it disables for the
    // whole run — including in a tab that never saw the 202. A miss here is a
    // WARNING, not a failure: the calls are already billed by this point, and
    // losing the whole take to a disabled-state frame that came and went is a
    // worse outcome than a video missing one scene.
    await page
      .getByRole("button", { name: "Running…" })
      .waitFor({ timeout: 20_000 })
      .catch(() => warn("the run action never showed its disabled state — the batch may have finished immediately."));
    await beat(page, 7, "The batch is running — the action stays disabled until it lands", 3400);
    await shot(page, "batch-running");

    batchA = await waitForBatch(batchA.id);
    if (batchA.cases_completed === 0) {
      throw new Error(
        `Every case in batch ${batchA.id} errored, so the batch has no aggregates and the metrics are ` +
          "unknown, not bad. Check the API log for the provider error before re-running — this take is billed.",
      );
    }
    log(
      `batch A ✓ ${batchA.status} · ${batchA.cases_completed}/${batchA.cases_total} · ` +
        `recall ${pct(batchA.recall)} · precision ${pct(batchA.precision)} · citation ${pct(batchA.citation_accuracy)}`,
    );

    // The tab polls its own dashboard every 4 s while a batch is in flight, so
    // the numbers arrive without a reload — waiting for the enabled action back
    // is waiting for exactly that.
    await runAll.waitFor({ timeout: 60_000 });
    await frame(note);
    await beat(
      page,
      8,
      `Landed: recall ${pct(batchA.recall)} · precision ${pct(batchA.precision)} · citation ${pct(batchA.citation_accuracy)}`,
      5400,
    );
    await shot(page, "metrics-landed");

    // ---- Scene 5: the prompt edit and the second batch ---------------------

    if (pre.twoBatches && pre.edit) {
      await page.goto(`${agentUrl}?tab=config`, { waitUntil: "networkidle" });
      // The vendored `FormField` renders a bare `<label>` with no `htmlFor` and
      // does not wrap its control, so `getByLabel` matches nothing here. The
      // field's own box is the anchor instead: label → its row → the FormField.
      const promptField = page.getByText("System prompt", { exact: true }).first().locator("xpath=../..");
      const promptBox = promptField.locator("textarea");
      // Wait BEFORE counting: the tab renders once the agent query resolves, and
      // a count taken a frame early reports 0 and blames the anchor.
      await promptBox.first().waitFor({ timeout: 30_000 });
      if ((await promptBox.count()) !== 1) {
        throw new Error(`Expected exactly one textarea in the System prompt field, found ${await promptBox.count()}.`);
      }
      await frame(promptBox);
      const firstLine = pre.edit.removed.split("\n")[0]!.trim();
      await beat(page, 9, `Old prompt vs new: removing one instruction — "${firstLine.slice(0, 64)}"`, 4200);
      await promptBox.fill(pre.edit.next);
      await sleep(900);
      await shot(page, "prompt-edited");

      const saved = page.waitForResponse(
        (r) => new URL(r.url()).pathname === `/agents/${agent.id}` && r.request().method() === "PUT",
        { timeout: 30_000 },
      );
      await page.getByRole("button", { name: "Save agent" }).click();
      const savedRes = await saved;
      promptEdited = true;
      const savedAgent = (await savedRes.json()) as Agent;
      if (savedAgent.system_prompt === originalPrompt) {
        throw new Error("The agent saved with an unchanged system prompt — the second batch would snapshot the same text.");
      }
      log(`prompt edited ✓ v${agent.version} → v${savedAgent.version}, ${pre.edit.removed.split("\n").length} line(s) removed`);
      await beat(page, 10, `Saved as v${savedAgent.version} — the next batch snapshots THIS prompt`, 3200);

      await page.goto(`${agentUrl}?tab=evals`, { waitUntil: "networkidle" });
      const runAgain = page.getByRole("button", { name: "Run all evals" });
      await frame(runAgain);
      await beat(page, 11, "The same set, the same model — one instruction lighter", 3000);
      batchB = await runBatchFrom(page, runAgain);
      batchB = await waitForBatch(batchB.id);
      if (batchB.cases_completed === 0) {
        throw new Error(`Every case in batch ${batchB.id} errored — the second run measured nothing.`);
      }
      log(
        `batch B ✓ ${batchB.status} · ${batchB.cases_completed}/${batchB.cases_total} · ` +
          `recall ${pct(batchB.recall)} · precision ${pct(batchB.precision)} · citation ${pct(batchB.citation_accuracy)}`,
      );
      await runAgain.waitFor({ timeout: 60_000 });
      await frame(note);
      await beat(page, 12, `Second run: recall ${pct(batchB.recall)} — the same cases, a different prompt`, 5000);
      await shot(page, "second-batch");
    } else {
      log(`reusing batch ${pre.priorBatch!.id.slice(0, 8)} as the "old prompt" side — no second set is run`);
    }

    // The pair the compare screen will show, in (older, newer) order — which is
    // the order the endpoint reports `b − a` in.
    const older = pre.twoBatches ? batchA : pre.priorBatch!;
    const newer = pre.twoBatches ? batchB! : batchA;

    // ---- Scene 6: the dashboard, from the sidebar --------------------------

    await beat(page, 13, "SKILLS LAB → Eval Dashboard: every agent's eval history in one place", 2800);
    await page.getByRole("link", { name: "Eval Dashboard" }).click();
    // The sidebar points at `/eval`; the dashboard then replaces the URL with
    // the agent it resolved, so the settled address is always `/eval/:agentId`.
    await page.waitForURL(/\/eval\/[^/]+$/, { timeout: 30_000 });
    await page.waitForLoadState("networkidle");

    // The picker defaults to the FIRST agent in the list, which need not be the
    // one this take ran, and it renders at all only when there is more than one.
    //
    // Which agent is on screen is read from the API rather than off the h1: that
    // heading is a flexbox holding the name AND the model slug, so its text is
    // "General Reviewer\ndeepseek/…" or "General Reviewer deepseek/…" depending
    // on how the line wraps, and neither is a name to match a button against.
    // `EvalDashboardView` picks `list[0]` of this very endpoint.
    const listed = await api<Agent[]>("/agents");
    const onScreenAgent = listed[0];
    if (onScreenAgent && onScreenAgent.id !== agent.id) {
      // The Dropdown's trigger is a button labelled with the CURRENT agent's
      // name; the menu entry is a button labelled with ours. Because those two
      // names differ in this branch, a name match cannot resolve to the trigger.
      await page.getByRole("button", { name: new RegExp(`^${escapeRe(onScreenAgent.name)}`) }).first().click();
      await page.getByRole("button", { name: new RegExp(`^${escapeRe(agent.name)}`) }).first().click();
      // Picking is a navigation now, so the URL is the thing to wait on.
      await page.waitForURL(`**/eval/${agent.id}`, { timeout: 30_000 });
      await page.waitForLoadState("networkidle");
    }
    await page
      .getByRole("heading", { level: 1, name: new RegExp(`^${escapeRe(agent.name)}`) })
      .waitFor({ timeout: 15_000 });
    await sleep(1200);
    await beat(page, 14, `${agent.name} — ${pre.cases.length + 1} cases, and every batch it has ever run`, 4600);
    await shot(page, "eval-dashboard");

    // ---- Scene 7: two runs, compared ---------------------------------------

    const history = await api<EvalBatchRecord[]>(`/agents/${agent.id}/eval-batches`);
    const olderIdx = history.findIndex((b) => b.id === older.id);
    const newerIdx = history.findIndex((b) => b.id === newer.id);
    if (olderIdx === -1 || newerIdx === -1) {
      throw new Error("One of the two batches is not in the agent's history — it cannot be selected on screen.");
    }
    const boxes = page.getByRole("checkbox", { name: "Select this run for comparison" });
    const boxCount = await boxes.count();
    if (boxCount !== history.length) {
      throw new Error(
        `The runs table shows ${boxCount} row(s) and the API lists ${history.length} — the row index cannot be ` +
          "trusted to name a batch.",
      );
    }
    await frame(boxes.nth(Math.max(olderIdx, newerIdx)));
    await beat(page, 15, "Exactly two runs — fewer or more, and Compare stays disabled", 3000);
    await boxes.nth(newerIdx).check();
    await boxes.nth(olderIdx).check();
    await sleep(1000);
    await shot(page, "two-runs-selected");

    const compared = page.waitForResponse(
      (r) => r.url().includes("/eval-batches/compare") && r.request().method() === "GET",
      { timeout: 30_000 },
    );
    // `exact` matters here: a non-exact name is a SUBSTRING match, and the modal
    // this click opens is titled "Compare runs".
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    const comparedRes = await compared;
    const comparedUrl = new URL(comparedRes.url());
    if (comparedUrl.searchParams.get("a") !== older.id || comparedUrl.searchParams.get("b") !== newer.id) {
      throw new Error(
        `Compare asked for a=${comparedUrl.searchParams.get("a")} b=${comparedUrl.searchParams.get("b")}; the ` +
          `two rows selected were older=${older.id} newer=${newer.id}. A reversed pair flips the sign of every delta.`,
      );
    }
    compare = (await comparedRes.json()) as EvalBatchCompare;

    // The claim the payoff frame makes, checked against the response behind it.
    if (compare.a.system_prompt_snapshot === compare.b.system_prompt_snapshot) {
      throw new Error("The two batches carry the same system prompt snapshot — there is no 'old prompt vs new' to show.");
    }
    if (!compare.prompt_diff_available) {
      throw new Error("One of the batches has no stored prompt snapshot, so the diff panel has nothing to render.");
    }
    if (!compare.comparable) {
      throw new Error(
        `The server marked these runs incomparable (${compare.a.provider}/${compare.a.model} vs ` +
          `${compare.b.provider}/${compare.b.model}) — a metric move across models says nothing about the prompt.`,
      );
    }
    if (compare.deltas.recall !== null && compare.a.recall !== null && compare.b.recall !== null) {
      const expected = compare.b.recall - compare.a.recall;
      // The server ROUNDS every delta to 6 decimal places on purpose, so that the
      // regression threshold is decided by the rule and not by IEEE-754 noise
      // (server/src/modules/evals/constants.ts). The tolerance here therefore has
      // to match that rounding — half a unit in the last retained place — not a
      // float epsilon. A 1e-9 tolerance asserts a precision the server never
      // promised and fails on an entirely correct payload: 0.232143 against
      // 0.23214285714285715 is off by 1.4e-7, three orders above 1e-9.
      const to6 = (n: number) => Math.round(n * 1e6) / 1e6;
      if (Math.abs(to6(compare.deltas.recall) - to6(expected)) > 5e-7) {
        throw new Error(
          `deltas.recall is ${compare.deltas.recall}, but b − a rounds to ${to6(expected)}.`,
        );
      }
    }
    log(
      `compare ✓ Δrecall ${points(compare.deltas.recall)} · Δprecision ${points(compare.deltas.precision)} · ` +
        `Δcitation ${points(compare.deltas.citation_accuracy)} · prompts differ · comparable`,
    );

    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ timeout: 20_000 });
    await sleep(1400);
    await beat(
      page,
      16,
      `Recall ${pct(compare.a.recall)} → ${pct(compare.b.recall)} (${points(compare.deltas.recall)}) — four deltas, one prompt change`,
      5600,
    );
    await shot(page, "compare-deltas");

    const diffLabel = dialog.getByText("System prompt diff", { exact: true });
    await frame(diffLabel);
    await beat(page, 17, "And the reason: the two prompt snapshots, diffed word by word", 5600);
    await shot(page, "prompt-diff");

    // ---- summary -----------------------------------------------------------

    const summary = {
      recorded_at: new Date().toISOString(),
      repo: pre.repo.full_name,
      pr: pre.pull.number,
      agent: {
        id: agent.id,
        name: agent.name,
        model: `${agent.provider}/${agent.model}`,
        version_at_start: agent.version,
      },
      seeded_case: {
        id: created.id,
        name: created.name,
        expectation: created.expectation,
        from_finding: { id: finding.id, file: finding.file, severity: finding.severity, decision: pre.decision },
        already_had_a_case: pre.seedsExistingCase,
      },
      cases_in_set: pre.cases.length + 1,
      batches: [older, newer].map((b) => ({
        id: b.id,
        agent_version: b.agent_version,
        status: b.status,
        cases: `${b.cases_completed}/${b.cases_total}`,
        recall: b.recall,
        precision: b.precision,
        citation_accuracy: b.citation_accuracy,
        cost_usd: b.cost_usd,
        prompt_snapshot_chars: b.system_prompt_snapshot?.length ?? null,
      })),
      billed_batches_this_take: pre.twoBatches ? 2 : 1,
      billed_model_calls_this_take: (pre.cases.length + 1) * (pre.twoBatches ? 2 : 1),
      prompt_edit: pre.edit ? { removed: pre.edit.removed } : null,
      compare: {
        deltas: compare.deltas,
        comparable: compare.comparable,
        prompt_diff_available: compare.prompt_diff_available,
      },
      asserted: {
        one_click_opened_no_dialog: true,
        expectation_matches_decision: `${pre.decision} → ${created.expectation}`,
        toast_carried_edit_case_link: true,
        scorer_note_on_screen: true,
        batch_completed_cases: older.cases_completed + newer.cases_completed,
        prompts_differ: true,
        delta_recall_equals_b_minus_a: true,
      },
    };
    writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));

    await page.close();
    await ctx.close();
    ctx = undefined;

    const raw = await page.video()?.path();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const final = join(OUT, `devdigest-evals-${stamp}.webm`);
    if (raw) renameSync(raw, final);
    const mp4 = raw ? toMp4(final) : null;

    log(`\x1b[32m✓ video:\x1b[0m ${mp4 ?? (raw ? final : "(not recorded)")}`);
    log(`\x1b[32m✓ frames + summary.json:\x1b[0m ${OUT}`);
  } finally {
    await ctx?.close();
    await browser?.close();

    // RESTORE, never clear, and even after a failure: the prompt is borrowed for
    // one scene, and a take that died mid-run must not leave an agent reviewing
    // with an instruction missing. The eval case this take created is left in
    // place on purpose — deleting it would cascade its runs out of the batches
    // just filmed (see the header).
    if (promptEdited) {
      await api<Agent>(`/agents/${agent.id}`, {
        method: "PUT",
        body: JSON.stringify({ system_prompt: originalPrompt }),
      })
        .then((a) => log(`system prompt restored (v${a.version})`))
        .catch(() => warn(`could not restore "${agent.name}"'s system prompt — put it back by hand.`));
    }
  }
}

main().catch((err) => {
  console.error(`\x1b[31m✗ ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
  process.exit(1);
});

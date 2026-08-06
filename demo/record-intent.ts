/**
 * DevDigest screencast recorder — L03: the Intent Layer.
 *
 * Five parts, one video:
 *
 *  1. The card, before anything. `?tab=findings` opens on an empty Intent card:
 *     the PR's motivation has not been derived yet.
 *  2. The derivation, inside a real review. One agent is triggered and the Live
 *     Log streams the two model calls in the order they happen, each labelled by
 *     ROLE — `INTENT CLASSIFIER … (cheap pass)` then `REVIEW model … (main
 *     pass)`. That labelling is the only thing that makes "the classifier runs
 *     on its own cheap model" checkable at a glance: the two slugs differ by the
 *     `-0731` suffix alone.
 *  3. The reuse. A SECOND trigger on the same head says so in the log and pays
 *     nothing — one derivation per commit, shared by every agent behind it.
 *  4. The trace. `derive_intent` sits next to `review_file` with its own model,
 *     tokens and dollars, and the prompt assembly carries a `PR intent —
 *     derived` block holding the summary and scope lists — no diff, no fetched
 *     file content.
 *  5. Staleness. A different PR whose intent was derived against an older commit
 *     shows the stale badge, and `Re-derive` refreshes it against the new head.
 *
 * COSTS MONEY. Two review passes plus one classifier call on the target PR, and
 * one more classifier call on the stale PR — roughly $0.003-0.01 depending on
 * the diff. `record:skills` is the free one.
 *
 * It ASSERTS one claim rather than just filming it (see `assertTwoPasses`): the
 * trace must show two distinct passes on two distinct models. A regression that
 * quietly reviewed on the classifier's model, or dropped the `derive_intent`
 * entry, would still have produced a plausible-looking video — and that claim is
 * an item on the lab's acceptance list.
 *
 * Prereqs: the dev stack is up (`../scripts/dev.sh`), `npm run setup` has
 * fetched Chromium, and the target PR is a genuinely imported one with a real
 * diff — a seeded PR carries `patch: null`, so the classifier sees no changed
 * files and the review has nothing to ground against.
 *
 * The first scene needs the target PR to have NO intent row yet. There is no
 * DELETE route (nothing in the product deletes an intent), so a re-take against
 * an already-derived PR films the derived card instead and says so. To get the
 * empty state back:
 *
 *   docker exec devdigest-postgres psql -U devdigest -d devdigest \
 *     -c "delete from pr_intent where pr_id = '<pr uuid>';"
 *
 * Env (all optional):
 *   DEMO_BASE_URL     web origin        default http://localhost:3000
 *   DEMO_API_URL      API origin        default http://localhost:3001
 *   DEMO_OUT          output dir        default ./recordings/l03-intent
 *   DEMO_REPO         repo full_name    default teplyakoff/dev-digest
 *   DEMO_PR           PR number         default 4     (derivation + review)
 *   DEMO_STALE_PR     PR number         default 5     ("" to skip part 5)
 *   DEMO_AGENT        first agent       default General Reviewer
 *   DEMO_AGENT_2      reuse agent       default Security Reviewer ("" to skip part 3)
 *   DEMO_HEADED       "1" to watch      default headless
 *   DEMO_RUN_TIMEOUT  ms per trigger    default 900000
 *
 * Usage:
 *   npm run record:intent
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const API = process.env.DEMO_API_URL ?? "http://localhost:3001";
const OUT = process.env.DEMO_OUT ?? join(HERE, "recordings", "l03-intent");
const REPO_NAME = process.env.DEMO_REPO ?? "teplyakoff/dev-digest";
const PR_NUMBER = Number(process.env.DEMO_PR ?? 4);
const STALE_PR = process.env.DEMO_STALE_PR ?? "5";
const AGENT_1 = process.env.DEMO_AGENT ?? "General Reviewer";
const AGENT_2 = process.env.DEMO_AGENT_2 ?? "Security Reviewer";
const HEADED = process.env.DEMO_HEADED === "1";
const RUN_TIMEOUT = Number(process.env.DEMO_RUN_TIMEOUT ?? 900_000);

const VIEWPORT = { width: 1280, height: 720 };
const CAPTION_ID = "__devdigest_caption";

interface Repo { id: string; full_name: string }
interface Pull { id: string; number: number; title: string; head_sha: string | null }
interface IntentSource { kind: string; ref: string; status: string; note?: string | null }
interface IntentRecord {
  pr_id: string;
  summary: string;
  in_scope: string[];
  out_of_scope: string[];
  confidence: string;
  sources: IntentSource[];
  missing_context: string[];
  head_sha: string;
  provider: string;
  model: string;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
}
interface RunSummary {
  run_id: string;
  agent_name: string | null;
  status: string | null;
  model: string | null;
  cost_usd: number | null;
  findings_count: number | null;
  score: number | null;
}
interface ToolCall { tool: string; args?: string | null; meta?: string | null; ms?: number | null }
interface Trace {
  tool_calls: ToolCall[];
  prompt_assembly: { intent?: string | null };
}

const TERMINAL = new Set(["done", "failed", "cancelled"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let shotNo = 0;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

function log(msg: string) {
  console.log(`\x1b[36m•\x1b[0m ${msg}`);
}
function warn(msg: string) {
  console.warn(`\x1b[33m!\x1b[0m ${msg}`);
}

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
 * Wait for a Live-Log line and SCROLL IT INTO FRAME.
 *
 * `LiveLogStream` is a fixed-height pane (420px) that does not follow its own
 * tail, and `page.mouse.wheel()` moves whatever is under the cursor — which
 * starts over the sidebar. So a line can be in the DOM, satisfy `waitFor`, and
 * sit well below the visible viewport: the first take of this recording captioned
 * three stills "INTENT CLASSIFIER…" / "REVIEW model…" over a pane still showing
 * "Loading PR diff…". Only `scrollIntoViewIfNeeded()` on an element INSIDE the
 * pane moves it, and it lands the target at the bottom edge, which is what puts
 * the preceding lines in frame above it.
 */
async function showLogLine(page: Page, re: RegExp, timeout = 180_000) {
  const line = page.getByText(re).first();
  await line.waitFor({ timeout });
  await line.scrollIntoViewIfNeeded();
  await sleep(500);
  return line;
}

/** Playwright records WebM; mp4 also plays in QuickTime and Keynote. */
function toMp4(webm: string): string | null {
  const mp4 = webm.replace(/\.webm$/, ".mp4");
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
 * Poll the API rather than the DOM: it reports WHY a run failed, where a DOM
 * wait can only time out. Stuck runs are cancelled before bailing so the next
 * take does not start against a wedged stack — though a cancel only marks the
 * row, and a very slow provider call still bills for what it eventually returns.
 */
async function waitForRuns(prId: string, runIds: string[]): Promise<RunSummary[]> {
  const deadline = Date.now() + RUN_TIMEOUT;
  for (;;) {
    const runs = (await api<RunSummary[]>(`/pulls/${prId}/runs`)).filter((r) => runIds.includes(r.run_id));
    if (runs.length === runIds.length && runs.every((r) => TERMINAL.has(r.status ?? ""))) return runs;
    if (Date.now() > deadline) {
      const stuck = runs.filter((r) => !TERMINAL.has(r.status ?? ""));
      for (const r of stuck) await api(`/runs/${r.run_id}/cancel`, { method: "POST" }).catch(() => {});
      throw new Error(
        `Runs did not settle within ${RUN_TIMEOUT}ms (cancelled) — stuck on: ` +
          stuck.map((r) => r.agent_name).join(", "),
      );
    }
    await sleep(2000);
  }
}

/** Open the Run Review dropdown and start exactly one agent, returning its run ids. */
async function triggerAgent(page: Page, agentName: string): Promise<string[]> {
  await page.getByRole("button", { name: /Run Review/i }).click();
  const runAll = page.getByRole("button", { name: "Run all enabled agents" });
  await runAll.waitFor({ timeout: 10_000 });
  // The menu is the button's own parent; scoping to it keeps the agent's name
  // from matching a run row of the same name in the timeline below. The name is
  // a PREFIX match, not exact: a `DropdownItem` renders its hint inside the same
  // button, so the accessible name is "General Reviewer deepseek/deepseek-v4-flash".
  const menu = runAll.locator("xpath=..");
  const started = page.waitForResponse(
    (r) => r.url().includes("/review") && r.request().method() === "POST",
    { timeout: 60_000 },
  );
  await menu.getByRole("button", { name: new RegExp(`^${agentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
  const res = await started;
  return ((await res.json()) as { runs: { run_id: string }[] }).runs.map((r) => r.run_id);
}

/**
 * The one claim this recording exists to make, checked rather than filmed.
 *
 * Two passes, two models: a `derive_intent` entry labelled as the cheap
 * classifier, a `review_file` entry beside it, and a classifier slug that is not
 * the reviewing agent's. The classifier default and the seeded agents' model
 * differ by the `-0731` suffix alone, so a regression that reviewed on the
 * classifier's model — or dropped the `derive_intent` entry altogether — would
 * still have filmed a video that looks right.
 */
function assertTwoPasses(trace: Trace, reviewModel: string | null): { classifierModel: string; reviewModel: string } {
  const derive = trace.tool_calls.find((tc) => tc.tool === "derive_intent");
  const review = trace.tool_calls.find((tc) => tc.tool === "review_file");
  if (!derive) throw new Error("The trace has no `derive_intent` tool call — the classifier pass is invisible.");
  if (!review) throw new Error("The trace has no `review_file` tool call — there is no second pass to contrast.");
  if (!(derive.meta ?? "").startsWith("cheap classifier")) {
    throw new Error(`\`derive_intent\` meta does not lead with its role: ${derive.meta}`);
  }
  const classifierModel = derive.args ?? "";
  if (!classifierModel) throw new Error("`derive_intent` records no model — the cheap pass cannot be identified.");
  if (!reviewModel) throw new Error("The run records no review model to compare the classifier against.");
  if (classifierModel === reviewModel) {
    throw new Error(`Both passes ran on ${classifierModel} — the classifier is not a separate cheap model.`);
  }
  if (trace.prompt_assembly.intent == null) {
    throw new Error("The prompt assembly carries no intent block — the derivation never reached the reviewer.");
  }
  return { classifierModel, reviewModel };
}

/**
 * The run whose trace the drawer scenes open on.
 *
 * A run that settles is not a run whose trace exists: `saveRunTrace` is the last
 * thing `runOneAgent` does, and a run reaped out from under a live provider call
 * settles as `failed` minutes before its trace lands. So candidates are tried in
 * order and each one's trace is FETCHED and checked, rather than picked by
 * status and hoped for — the first take of this recording died on a 404 from a
 * run that was `failed` at the time and had a perfectly good trace 40 s later.
 *
 * Preference: a run from this take that derived the intent itself (its
 * `derive_intent` carries real tokens and dollars), then one that reused it,
 * then any other run on the PR — which is weaker evidence, so it is warned about
 * and recorded in the summary.
 */
async function pickTraceRun(
  prId: string,
  preferred: string[],
): Promise<{ run: RunSummary; trace: Trace; fresh: boolean; fromThisTake: boolean }> {
  const all = await api<RunSummary[]>(`/pulls/${prId}/runs`);
  const byId = new Map(all.map((r) => [r.run_id, r]));
  const ordered = [
    ...preferred.map((id) => byId.get(id)).filter((r): r is RunSummary => r != null),
    ...all.filter((r) => !preferred.includes(r.run_id)),
  ];

  const usable: { run: RunSummary; trace: Trace; fresh: boolean; fromThisTake: boolean }[] = [];
  for (const run of ordered) {
    const trace = await api<Trace>(`/runs/${run.run_id}/trace`).catch(() => null);
    if (!trace) continue;
    try {
      assertTwoPasses(trace, run.model);
    } catch {
      continue;
    }
    const derive = trace.tool_calls.find((tc) => tc.tool === "derive_intent");
    usable.push({
      run,
      trace,
      fresh: !(derive?.meta ?? "").includes("reused"),
      fromThisTake: preferred.includes(run.run_id),
    });
  }
  if (usable.length === 0) {
    throw new Error("No run on this PR has a trace showing both passes — nothing to film the trace scenes on.");
  }
  const rank = (c: (typeof usable)[number]) => (c.fromThisTake ? 0 : 2) + (c.fresh ? 0 : 1);
  usable.sort((a, b) => rank(a) - rank(b));
  return usable[0]!;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) {
    if (f.startsWith("page@") && f.endsWith(".webm")) rmSync(join(OUT, f), { force: true });
  }

  const repos = await api<Repo[]>("/repos");
  const repo = repos.find((r) => r.full_name === REPO_NAME);
  if (!repo) throw new Error(`Repo ${REPO_NAME} is not imported — add it first.`);

  const pulls = await api<Pull[]>(`/repos/${repo.id}/pulls`);
  const pull = pulls.find((p) => p.number === PR_NUMBER);
  if (!pull) throw new Error(`PR #${PR_NUMBER} is not imported into ${REPO_NAME}.`);
  const stalePull = STALE_PR ? pulls.find((p) => p.number === Number(STALE_PR)) : undefined;
  if (STALE_PR && !stalePull) warn(`PR #${STALE_PR} is not imported — skipping the staleness scenes.`);

  log(`target: ${repo.full_name} #${pull.number} — ${pull.title}`);

  const before = await api<{ intent: IntentRecord | null }>(`/pulls/${pull.id}/intent`);
  const startsEmpty = before.intent == null;
  if (!startsEmpty) {
    warn(`PR #${PR_NUMBER} already has an intent — filming the derived card instead of the empty state.`);
    warn("Delete the pr_intent row (see the header) for a take that starts from empty.");
  }

  let browser: Browser | undefined;
  let ctx: BrowserContext | undefined;

  try {
    browser = await chromium.launch({ headless: !HEADED });
    ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      colorScheme: "dark",
      recordVideo: { dir: OUT, size: VIEWPORT },
    });
    const page = await ctx.newPage();

    const prUrl = `${BASE}/repos/${repo.id}/pulls/${PR_NUMBER}`;

    // ---- Part 1: the card, before anything -------------------------------

    await page.goto(`${prUrl}?tab=findings`, { waitUntil: "networkidle" });
    await sleep(1200);
    await beat(
      page,
      1,
      startsEmpty
        ? "Before the review results sits the PR's intent — not derived yet"
        : "The Intent card sits above the review results",
      3600,
    );
    await shot(page, startsEmpty ? "intent-empty" : "intent-existing");

    // ---- Part 2: the derivation, inside a real review --------------------

    await beat(page, 2, `Run Review → ${AGENT_1}. The classifier runs first, once, for the whole trigger`, 3000);
    const runIds = await triggerAgent(page, AGENT_1);
    log(`started ${runIds.length} run(s): ${runIds.map((i) => i.slice(0, 8)).join(", ")}`);

    await caption(page, 3, "Live Log — what the classifier was given, by kind and size. Never the content");
    await showLogLine(page, /Intent sources:/);
    await sleep(2200);
    await shot(page, "live-log-intent-sources");

    await showLogLine(page, /INTENT CLASSIFIER model:/);
    await beat(page, 4, "Call 1 — INTENT CLASSIFIER, on its own cheap model, labelled by role", 4200);
    await shot(page, "live-log-classifier");

    await showLogLine(page, /Intent derived \(confidence=/);
    await beat(page, 5, "Derived: scope counts, sources used, tokens and dollars — for a third of a cent", 4200);
    await shot(page, "live-log-derived");

    await showLogLine(page, /REVIEW model:/);
    await beat(page, 6, "Call 2 — REVIEW, the main pass, on the agent's own model. Two passes, two models", 4400);
    await shot(page, "live-log-review-model");

    const runs = await waitForRuns(pull.id, runIds);
    const failed = runs.filter((r) => r.status === "failed");
    for (const r of failed) warn(`${r.agent_name} failed`);

    const derived = (await api<{ intent: IntentRecord | null }>(`/pulls/${pull.id}/intent`)).intent;
    if (!derived) throw new Error("The review finished without persisting an intent — nothing to film.");
    log(
      `intent: confidence=${derived.confidence}, ${derived.in_scope.length} in / ${derived.out_of_scope.length} out of scope, ` +
        `${derived.sources.filter((s) => s.status === "used").length} source(s) used, ` +
        `${derived.tokens_in} in / ${derived.tokens_out} out · $${derived.cost_usd?.toFixed(6) ?? "—"}`,
    );

    await page.goto(`${prUrl}?tab=findings`, { waitUntil: "networkidle" });
    await page
      .getByText(derived.summary.slice(0, 40), { exact: false })
      .first()
      .waitFor({ timeout: 20_000 })
      // Not worth losing a paid take over: the provenance line below is waited
      // on unconditionally and is the frame that actually matters.
      .catch(() => warn("could not match the summary text — filming the card anyway"));
    await sleep(1000);
    await beat(page, 7, `Intent, in the reviewer's own words — ${derived.in_scope.length} in scope, ${derived.out_of_scope.length} deliberately out`, 5000);
    await shot(page, "intent-card");

    // The provenance footer is what stops a thin derivation and a well-sourced
    // one looking identical — an unreachable source is NAMED, never quietly
    // replaced by invention.
    await page.getByText(/Derived by /).first().scrollIntoViewIfNeeded();
    await sleep(600);
    await beat(page, 8, "Every claim names what it rests on — and what could not be read", 4600);
    await shot(page, "intent-provenance");

    if (derived.missing_context.length > 0) {
      const shown = await page.getByText(/Could not be read:/).first().isVisible().catch(() => false);
      if (!shown) {
        throw new Error(
          `The record names ${derived.missing_context.length} unreadable source(s) and the card shows none: ` +
            derived.missing_context.join("; "),
        );
      }
      log(`missing context, rendered: ${derived.missing_context.join("; ")}`);
    }

    // ---- Part 3: the second trigger reuses it ----------------------------

    let reused = false;
    const runIds2: string[] = [];
    if (AGENT_2) {
      await beat(page, 9, `A second agent on the same commit — ${AGENT_2}`, 3000);
      runIds2.push(...(await triggerAgent(page, AGENT_2)));
      await caption(page, 10, "One derivation per commit: this run reads it and is not billed for it");
      reused = await showLogLine(page, /reusing the derivation/)
        .then(() => true)
        .catch(() => false);
      if (reused) {
        await sleep(2600);
        await shot(page, "live-log-reused");
      } else {
        warn("no reuse line in the log — the head moved, or the derivation was not found");
      }
      await waitForRuns(pull.id, runIds2);
    }

    // ---- Part 4: the trace ------------------------------------------------

    const picked = await pickTraceRun(pull.id, [...runIds, ...runIds2]);
    const traceRun = picked.run;
    const models = assertTwoPasses(picked.trace, traceRun.model);
    log(`two passes ✓ classifier ${models.classifierModel} ≠ review ${models.reviewModel}`);
    if (!picked.fromThisTake) {
      warn(`trace scenes fall back to an earlier run (${traceRun.run_id.slice(0, 8)}) — this take's runs had no usable trace.`);
    }

    await page.goto(`${prUrl}?tab=findings&trace=${traceRun.run_id}`, { waitUntil: "networkidle" });
    await page.getByText("Tool calls", { exact: true }).first().waitFor({ timeout: 20_000 });
    await page.getByText("derive_intent", { exact: false }).first().scrollIntoViewIfNeeded();
    await sleep(1000);
    await beat(page, 11, "Two calls in the trace: the cheap classifier and the review, each with its own cost", 5000);
    await shot(page, "trace-two-calls");

    await page.getByText("Prompt assembly", { exact: true }).first().click();
    await sleep(900);
    const intentBlock = page.getByText("PR intent — derived (dynamic)", { exact: false }).first();
    await intentBlock.waitFor({ timeout: 15_000 });
    await intentBlock.scrollIntoViewIfNeeded();
    await sleep(800);
    await beat(page, 12, "The block the reviewer actually read — summary and scope, no diff, no file contents", 5000);
    await shot(page, "trace-prompt-intent");

    // The drawer's `Tabs` are passed as bare strings (`["trace", "log"]`), so the
    // tab's label IS the key — there is no "Live log" text to click.
    await page.getByRole("button", { name: "log", exact: true }).first().click();
    await sleep(1200);
    await beat(page, 13, "The same two passes, persisted — the log survives the run", 4400);
    await shot(page, "trace-run-log");

    // ---- Part 5: the model registry --------------------------------------

    await page.goto(`${BASE}/settings/models`, { waitUntil: "networkidle" });
    await page.getByText("PR Review · Intent", { exact: false }).first().waitFor({ timeout: 20_000 });
    await sleep(900);
    await beat(page, 14, "The classifier is a configured feature model, not a hardcoded slug", 4600);
    await shot(page, "settings-models");

    // ---- Part 6: staleness -------------------------------------------------

    let staleShown = false;
    if (stalePull) {
      const staleUrl = `${BASE}/repos/${repo.id}/pulls/${stalePull.number}?tab=findings`;
      await page.goto(staleUrl, { waitUntil: "networkidle" });
      await sleep(1400);
      staleShown = await page
        .getByText("Derived against an older commit", { exact: false })
        .first()
        .isVisible()
        .catch(() => false);
      if (staleShown) {
        await beat(page, 15, `PR #${stalePull.number}: derived against an older commit — the card says so`, 4600);
        await shot(page, "intent-stale");

        const rederive = page.getByRole("button", { name: "Re-derive" }).first();
        await rederive.click();
        await beat(page, 16, "Re-derive — one classifier call against the new head, no review", 3000);
        await page
          .getByText("Derived against an older commit", { exact: false })
          .first()
          .waitFor({ state: "hidden", timeout: 180_000 });
        await sleep(1400);
        await beat(page, 17, "Fresh against the current commit — the badge is gone", 4400);
        await shot(page, "intent-rederived");
      } else {
        warn(`PR #${stalePull.number} shows no stale intent — filming re-derive on the target PR instead.`);
      }
    }

    // Staleness is not something a recorder can manufacture: it needs a PR whose
    // head has moved since its intent was derived, and only a push does that. So
    // when no stale PR is available the on-demand half is filmed on the target
    // PR — the button is the same one, and the claim ("the user can force a
    // fresh derivation") is one this take can honestly make.
    if (!staleShown) {
      await page.goto(`${prUrl}?tab=findings`, { waitUntil: "networkidle" });
      await sleep(1200);
      const rederive = page.getByRole("button", { name: "Re-derive" }).first();
      await rederive.scrollIntoViewIfNeeded();
      await beat(page, 15, "Re-derive is always available — one classifier call, no review", 3600);
      const done = page.waitForResponse(
        (r) => r.url().includes("/intent") && r.request().method() === "POST",
        { timeout: 180_000 },
      );
      await rederive.click();
      await done;
      await sleep(1600);
      await beat(page, 16, "Refreshed against the current head, for a fraction of a cent", 4400);
      await shot(page, "intent-rederived");
    }

    const summary = {
      recorded_at: new Date().toISOString(),
      repo: repo.full_name,
      pr: pull.number,
      started_empty: startsEmpty,
      intent: {
        summary: derived.summary,
        confidence: derived.confidence,
        in_scope: derived.in_scope,
        out_of_scope: derived.out_of_scope,
        sources: derived.sources,
        missing_context: derived.missing_context,
        head_sha: derived.head_sha,
        model: `${derived.provider}/${derived.model}`,
        tokens_in: derived.tokens_in,
        tokens_out: derived.tokens_out,
        cost_usd: derived.cost_usd,
      },
      two_passes: { ...models, trace_run: traceRun.run_id, from_this_take: picked.fromThisTake, fresh_derivation: picked.fresh },
      reuse_line_shown: reused,
      stale_scenes_shown: staleShown,
      runs: runs.map((r) => ({
        run_id: r.run_id,
        agent: r.agent_name,
        status: r.status,
        model: r.model,
        cost_usd: r.cost_usd,
        findings: r.findings_count,
        score: r.score,
      })),
    };
    writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));

    await page.close();
    await ctx.close();
    ctx = undefined;

    const raw = await page.video()?.path();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const final = join(OUT, `devdigest-intent-${stamp}.webm`);
    if (raw) renameSync(raw, final);
    const mp4 = raw ? toMp4(final) : null;

    log(`\x1b[32m✓ video:\x1b[0m ${mp4 ?? (raw ? final : "(not recorded)")}`);
    log(`\x1b[32m✓ frames + summary.json:\x1b[0m ${OUT}`);
    console.table(summary.runs);
    if (failed.length) process.exitCode = 1;
  } finally {
    await ctx?.close();
    await browser?.close();
  }
}

main().catch((err) => {
  console.error(`\x1b[31m✗ ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
  process.exit(1);
});

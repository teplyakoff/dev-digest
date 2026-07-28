/**
 * DevDigest screencast recorder — Playwright, real stack, real LLM run.
 *
 * Drives the running dev stack through the full review loop and writes a video
 * plus one PNG per step. Unlike `../e2e`, this DOES spend money: it triggers a
 * real `POST /pulls/:id/review`, so every enabled agent makes a real model call.
 * That is the point — the recording is evidence the loop works end to end, and
 * the Run Cost Badge only has something to show once a run has actually been
 * paid for.
 *
 * Prereqs: the dev stack is up (`../scripts/dev.sh`), a repo with a real diff is
 * imported, and `npm run setup` has fetched the Chromium build.
 *
 * Env (all optional):
 *   DEMO_BASE_URL   web origin                  default http://localhost:3000
 *   DEMO_API_URL    API origin                  default http://localhost:3001
 *   DEMO_REPO       repo full_name (substring)  default: first repo that has a PR
 *   DEMO_PR         PR number                   default: that repo's first PR
 *   DEMO_OUT        output dir                  default ./recordings
 *   DEMO_HEADED     "1" to watch it live        default headless
 *   DEMO_RUN_TIMEOUT  ms to wait for the run    default 300000
 *
 * Usage:
 *   npm run record
 *   DEMO_REPO=acme/payments-api DEMO_PR=482 npm run record
 */
import { chromium, type Page, type Browser, type BrowserContext } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const API = process.env.DEMO_API_URL ?? "http://localhost:3001";
const OUT = process.env.DEMO_OUT ?? join(HERE, "recordings");
const HEADED = process.env.DEMO_HEADED === "1";
const RUN_TIMEOUT = Number(process.env.DEMO_RUN_TIMEOUT ?? 300_000);

/** 720p keeps the app's desktop layout while staying small enough to share. */
const VIEWPORT = { width: 1280, height: 720 };

// --- tiny helpers ------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

function log(msg: string) {
  process.stdout.write(`\x1b[36m▸\x1b[0m ${msg}\n`);
}

// --- caption overlay ---------------------------------------------------------
// The video has no audio, so each step narrates itself in a banner pinned over
// the app. Injected per navigation because a client-side route change wipes it.

const CAPTION_ID = "__devdigest_demo_caption__";

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

/** A caption + a beat long enough to read it before the next action. */
async function beat(page: Page, step: number, text: string, ms = 2600) {
  await caption(page, step, text);
  await sleep(ms);
}

/**
 * Playwright records VP8/WebM and nothing else, and the ffmpeg it bundles is
 * built with libvpx only — it cannot produce H.264. So if a real ffmpeg is on
 * PATH, hand it the recording: H.264/mp4 plays where WebM does not (QuickTime,
 * Keynote, PowerPoint), and for this screen content it comes out roughly half
 * the size. Purely additive — no ffmpeg, no mp4, the webm is still the output.
 */
function toMp4(webm: string): string | null {
  const mp4 = webm.replace(/\.webm$/, ".mp4");
  const res = spawnSync(
    "ffmpeg",
    // fmt: off
    [
      "-hide_banner", "-loglevel", "error", "-y", "-i", webm,
      "-c:v", "libx264", "-preset", "slow", "-crf", "28",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
      mp4,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  if (res.error || res.status !== 0) {
    log(res.error?.message.includes("ENOENT") ? "ffmpeg not on PATH — keeping the webm" : "ffmpeg failed — keeping the webm");
    rmSync(mp4, { force: true });
    return null;
  }
  rmSync(webm, { force: true });
  return mp4;
}

let shotNo = 0;
async function shot(page: Page, name: string) {
  const file = join(OUT, `${String(++shotNo).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file });
}

// --- target resolution -------------------------------------------------------

type Repo = { id: string; full_name: string };
type Pull = { id: string; number: number; title: string; cost_usd: number | null; score: number | null };

async function resolveTarget(): Promise<{ repo: Repo; pull: Pull }> {
  const repos = await api<Repo[]>("/repos");
  if (!repos.length) throw new Error("No repos imported — import one in the UI first.");

  const wanted = process.env.DEMO_REPO;
  const candidates = wanted ? repos.filter((r) => r.full_name.includes(wanted)) : repos;
  if (wanted && !candidates.length) {
    throw new Error(`DEMO_REPO="${wanted}" matched none of: ${repos.map((r) => r.full_name).join(", ")}`);
  }

  for (const repo of candidates) {
    const pulls = await api<Pull[]>(`/repos/${repo.id}/pulls`);
    if (!pulls.length) continue;
    const num = process.env.DEMO_PR;
    const pull = num ? pulls.find((p) => String(p.number) === num) : pulls[0];
    if (!pull) {
      if (num) throw new Error(`PR #${num} not found in ${repo.full_name}`);
      continue;
    }
    return { repo, pull };
  }
  throw new Error("No repo with an open PR found — poll a repo in the UI first.");
}

// --- run polling -------------------------------------------------------------

type RunSummary = {
  run_id: string;
  agent_name: string | null;
  status: string | null;
  cost_usd: number | null;
  findings_count: number | null;
  score: number | null;
};

const TERMINAL = new Set(["done", "failed", "cancelled"]);

/**
 * Poll the run history until every run started by this recording settles.
 * The DOM would do too, but the API is the thing under test and it tells us
 * WHY a run failed instead of just timing the UI out.
 *
 * On timeout the runs are cancelled before we bail. Agents execute
 * sequentially, and nothing puts a deadline on the provider call — so one
 * wedged upstream request leaves the run, and every agent queued behind it,
 * "running" forever. Walking away without cancelling wedges the next recording
 * too.
 */
async function waitForRuns(prId: string, runIds: string[]): Promise<RunSummary[]> {
  const deadline = Date.now() + RUN_TIMEOUT;
  for (;;) {
    const runs = (await api<RunSummary[]>(`/pulls/${prId}/runs`)).filter((r) => runIds.includes(r.run_id));
    if (runs.length === runIds.length && runs.every((r) => TERMINAL.has(r.status ?? ""))) return runs;
    if (Date.now() > deadline) {
      const stuck = runs.filter((r) => !TERMINAL.has(r.status ?? ""));
      for (const r of stuck) {
        await api(`/runs/${r.run_id}/cancel`, { method: "POST" }).catch(() => {});
      }
      throw new Error(
        `Runs did not settle within ${RUN_TIMEOUT}ms (cancelled) — was stuck on: ` +
          stuck.map((r) => r.agent_name).join(", "),
      );
    }
    await sleep(2000);
  }
}

// --- the recording -----------------------------------------------------------

async function main() {
  mkdirSync(OUT, { recursive: true });
  // Playwright writes the video under the page's guid and we only rename it on
  // success, so an aborted run (a wedged agent, Ctrl-C) leaves a `page@…webm`
  // behind. Sweep them here rather than growing a pile of orphans.
  for (const f of readdirSync(OUT)) {
    if (f.startsWith("page@") && f.endsWith(".webm")) rmSync(join(OUT, f), { force: true });
  }

  const { repo, pull } = await resolveTarget();
  log(`target: ${repo.full_name} #${pull.number} — ${pull.title}`);
  log(`cost before this run: ${pull.cost_usd == null ? "— (unknown)" : `$${pull.cost_usd}`}`);

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
    // Captions live in the DOM, so a client-side route change drops them; the
    // per-step caption() call re-creates the node, this just avoids a flash.
    page.on("framenavigated", () => void 0);

    const listUrl = `${BASE}/repos/${repo.id}/pulls`;
    const prUrl = `${listUrl}/${pull.number}`;

    // 1 — the list, before -------------------------------------------------
    await page.goto(listUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByText(pull.title, { exact: false }).first().waitFor({ timeout: 15_000 });
    await beat(page, 1, "Pull Requests — every row carries SCORE and COST", 3000);
    await shot(page, "pr-list-before");

    // 2 — the PR -----------------------------------------------------------
    // Straight to the "Agent runs" tab: "Overview" only renders the PR body,
    // which is blank on a PR opened without a description.
    await page.getByText(pull.title, { exact: false }).first().click();
    await page.waitForURL(`**/pulls/${pull.number}`, { timeout: 15_000 });
    await page.goto(`${prUrl}?tab=findings`, { waitUntil: "networkidle" });
    await beat(page, 2, `PR #${pull.number} — ${pull.title}`, 2600);
    await shot(page, "pr-detail-before");

    // 3 — kick off the agents ---------------------------------------------
    await beat(page, 3, "Run Review → run every enabled agent against this diff", 2400);
    await page.getByRole("button", { name: /Run Review/i }).click();
    const runAll = page.getByText("Run all enabled agents", { exact: true });
    await runAll.waitFor({ timeout: 10_000 });
    await sleep(1200); // let the dropdown render into the video
    await shot(page, "run-review-dropdown");

    // Capture the run ids the click creates, so polling watches exactly these.
    const started = page.waitForResponse(
      (r) => r.url().includes("/review") && r.request().method() === "POST",
      { timeout: 60_000 },
    );
    await runAll.click();
    const res = await started;
    const runIds: string[] = ((await res.json()) as { runs: { run_id: string }[] }).runs.map((r) => r.run_id);
    log(`started ${runIds.length} agent run(s)`);

    // 4 — agents working ---------------------------------------------------
    // Kicking off a run already switches to the "Agent runs" tab (onRunStart),
    // so there is nothing to click — just let the live status stream.
    await caption(page, 4, `${runIds.length} agents running against the diff — live`);
    await sleep(3000);
    await shot(page, "agents-running");

    const runs = await waitForRuns(pull.id, runIds);
    const failed = runs.filter((r) => r.status === "failed");
    for (const r of failed) log(`\x1b[33m! ${r.agent_name} failed\x1b[0m`);

    // 5 — results ----------------------------------------------------------
    await page.goto(`${prUrl}?tab=findings`, { waitUntil: "networkidle" });
    const totalCost = runs.reduce<number | null>(
      // null poisons the total: one unpriced run makes the sum unknown, not partial.
      (acc, r) => (acc == null || r.cost_usd == null ? null : acc + r.cost_usd),
      0,
    );
    const costLabel = totalCost == null ? "cost unknown" : `$${totalCost.toFixed(6)} total`;
    await beat(page, 5, `Timeline — ${runs.length} runs, ${costLabel}`, 3600);
    await shot(page, "agent-runs-done");

    // 6 — verdict + cost badge --------------------------------------------
    // The run accordions sit below the timeline and the newest one is expanded
    // by default, so its VerdictBanner is already rendered — just scroll to it.
    // "PR SCORE" is the banner's own label and appears nowhere else.
    const banner = page.getByText("PR SCORE", { exact: false }).first();
    if (await banner.isVisible().catch(() => false)) {
      await banner.scrollIntoViewIfNeeded();
      await sleep(1200);
      await beat(page, 6, "Verdict banner — PR score and what this run cost", 3600);
      await shot(page, "verdict-cost-badge");
    } else {
      log("! verdict banner not found — skipping");
    }

    // 7 — trace ------------------------------------------------------------
    // The drawer is URL-driven (?trace=<runId>), which beats hunting for the
    // per-row icon. Prefer the run that actually found something.
    const traceRun = [...runs].sort((a, b) => (b.findings_count ?? 0) - (a.findings_count ?? 0))[0];
    if (traceRun) {
      await page.goto(`${prUrl}?tab=findings&trace=${traceRun.run_id}`, { waitUntil: "networkidle" });
      await page.getByText("COST", { exact: true }).first().waitFor({ timeout: 20_000 });
      await sleep(1200);
      await beat(page, 7, `Run trace · ${traceRun.agent_name} — prompt, tokens and COST`, 4000);
      await shot(page, "run-trace-cost");
    }

    // 8 — the list, after --------------------------------------------------
    await page.goto(listUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "All", exact: true }).click();
    await sleep(1500);
    await beat(page, 8, "Back on the list — the COST column now shows this run", 3600);
    await shot(page, "pr-list-after");

    // Summary written next to the video so the numbers are checkable later.
    const after = (await api<Pull[]>(`/repos/${repo.id}/pulls`)).find((p) => p.id === pull.id);
    const summary = {
      recorded_at: new Date().toISOString(),
      repo: repo.full_name,
      pr: pull.number,
      title: pull.title,
      cost_before: pull.cost_usd,
      cost_after: after?.cost_usd ?? null,
      score_after: after?.score ?? null,
      runs: runs.map((r) => ({
        agent: r.agent_name,
        status: r.status,
        cost_usd: r.cost_usd,
        findings: r.findings_count,
        score: r.score,
      })),
    };
    writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));

    await page.close();
    await ctx.close();
    ctx = undefined;

    // Playwright names the video after the page's guid; rename it to something
    // a human can find. The file only exists once the context is closed.
    const raw = await page.video()?.path();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const final = join(OUT, `devdigest-review-loop-${stamp}.webm`);
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

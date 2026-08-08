/**
 * DevDigest screencast recorder — L03 homework: the Smart Diff.
 *
 * Ten scenes, one per acceptance criterion, in one unedited take:
 *
 *   1.  Files changed in ORIGINAL order — the ordering the API returns, with no
 *       finding visible on any line (structural: `DiffViewer` has no way to
 *       receive findings at all).
 *   2.  Toggle to SMART order — the section label flips to
 *       "Smart Diff · grouped by role".
 *   3.  The summary strip (files, +/−, findings, changed lines) and the
 *       large-PR banner.
 *   4.  Core logic on top, with its role swatch and description.
 *   5.  The lock-file inside a COLLAPSED Boilerplate group — present, body not
 *       rendered.
 *   6.  A large file's `large file` chip.
 *   7.  Run Review → every enabled agent, sequentially. THIS IS THE MONEY.
 *   8.  Badges and line rails appear with NO RELOAD — the whole point of S6's
 *       invalidator. Proved, not asserted by eye: a marker is written into
 *       `window` before the run and read back after the badges are on screen,
 *       so a reload anywhere in between would have wiped it.
 *   9.  Click a finding's severity tag → `?tab=findings&finding=<id>`, the Agent
 *       runs tab, the owning accordion open, that finding's card expanded and
 *       highlighted.
 *   10. Browser Back → `?tab=diff&view=smart`, still in Smart mode.
 *   11. (free, added) Original order again — now that findings EXIST, the
 *       absence of every badge, rail and tag is evidence rather than a tautology.
 *       Scene 1 is filmed before any review, so on its own it proves nothing.
 *
 * TWO SCENES OF THE PLAN'S LIST ARE NOT FILMABLE HERE, and are not faked:
 *
 *   - "the API log pane showing the `SMART DIFF:` line with no model line beside
 *     it" — that line goes to the API process's stdout
 *     (`server/src/modules/smart-diff/service.ts:255`), not to any pane in the
 *     web UI. A browser recorder cannot see it.
 *   - "the terminal running `verify:l03` with both lanes green" — a browser
 *     recorder cannot film a terminal.
 *
 * Both are said out loud in this script's own output and recorded in
 * `summary.json` under `not_filmable`, and both are captured separately as text
 * evidence. `demo/INSIGHTS.md` (2026-08-06) is emphatic that a state the
 * recorder cannot manufacture gets named rather than staged.
 *
 * COSTS REAL MONEY. One `POST /pulls/:id/review` with `all: true`, so every
 * enabled agent runs sequentially over a 100-file diff. Budget accordingly and
 * run it ONCE — a take abandoned on timeout still pays for the runs it started
 * (`demo/INSIGHTS.md`, 2026-07-28).
 *
 * DO NOT run any package's test suite while this is in flight. `buildApp` awaits
 * the orphan-run reaper on every construction and `server/test/routes-smoke.test.ts`
 * builds against the ambient `DATABASE_URL`, so `vitest run` in another terminal
 * marks the live `running` rows `failed` — it has already cost one billed run.
 *
 * Prereqs: the dev stack is up (`../scripts/dev.sh`), `npm run setup` has
 * fetched Chromium, and DEMO_PR points at a GENUINELY IMPORTED PR whose files
 * carry real `patch` text. A seeded PR has `patch: null`, so no diff body
 * renders, no finding can anchor to a line, and the per-line rail — half of what
 * this feature is — has nothing to draw on. The preflight below refuses to
 * launch the browser (and so refuses to spend anything) when that is the case.
 *
 * WHY #3 AND NOT #4/#5, which the earlier L03 recorders used: 100 changed files
 * all carrying a real patch; a `client/pnpm-lock.yaml` (+827 −2) for the
 * lock-file criterion; 10 518 changed lines so the large-PR banner fires; and no
 * findings yet, which is what makes scene 8 real rather than staged.
 *
 * Env (all optional):
 *   DEMO_BASE_URL     web origin       default http://localhost:3000
 *   DEMO_API_URL      API origin       default http://localhost:3001
 *   DEMO_OUT          output dir       default ./recordings/l03-smart-diff
 *   DEMO_REPO         repo full_name   default teplyakoff/dev-digest
 *   DEMO_PR           PR number        default 3
 *   DEMO_HEADED       "1" to watch     default headless
 *   DEMO_RUN_TIMEOUT  ms for ALL runs  default 2400000 (40 min)
 *
 * Usage:
 *   npm run record:smart-diff
 */
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const API = process.env.DEMO_API_URL ?? "http://localhost:3001";
const OUT = process.env.DEMO_OUT ?? join(HERE, "recordings", "l03-smart-diff");
const REPO_NAME = process.env.DEMO_REPO ?? "teplyakoff/dev-digest";
const PR_NUMBER = Number(process.env.DEMO_PR ?? 3);
const HEADED = process.env.DEMO_HEADED === "1";
/**
 * The ceiling for EVERY agent, not one.
 *
 * `all: true` runs the enabled agents SEQUENTIALLY, and observed per-run times
 * on a PR this size are 30-290 s with one measured outlier at 945 s
 * (`demo/INSIGHTS.md`, 2026-07-28). Five agents plus one outlier does not fit in
 * the 900 s the single-agent recorders use. Since a take abandoned on timeout
 * still bills for the runs it started, a too-generous ceiling costs nothing and
 * a too-tight one costs the whole take.
 */
const RUN_TIMEOUT = Number(process.env.DEMO_RUN_TIMEOUT ?? 2_400_000);

const VIEWPORT = { width: 1280, height: 720 };
const CAPTION_ID = "__devdigest_caption";
/** Written into `window` before the run, read back after scene 8. A reload — or
    any full navigation — drops it, which is exactly the claim under test. */
const RELOAD_MARKER = "__devdigest_smart_diff_marker";

/** Lock-files, by the same rule the classifier uses (`smart-diff/constants.ts`). */
const LOCK_FILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|bun\.lockb)$|\.lock$/;

interface Repo { id: string; full_name: string }
interface Pull { id: string; number: number; title: string }
interface PrFile { path: string; additions: number | null; deletions: number | null; patch: string | null }
interface PrDetail { number: number; title: string; status: string; files_count: number; files: PrFile[] }
interface Agent { id: string; name: string; model: string; enabled: boolean }
interface SmartDiffFinding { id: string; line: number; severity: string; title: string }
interface SmartDiffFile {
  path: string;
  additions: number;
  deletions: number;
  finding_lines: number[];
  findings: SmartDiffFinding[];
  is_large: boolean;
}
interface SmartDiffGroup { role: "core" | "wiring" | "boilerplate"; files: SmartDiffFile[] }
interface SmartDiff {
  groups: SmartDiffGroup[];
  split_suggestion: { too_big: boolean; total_lines: number; proposed_splits: unknown[] };
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
interface ReviewRecord { run_id: string | null; agent_name: string | null; findings: { id: string }[] }

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
function note(msg: string) {
  console.log(`\x1b[35m▸\x1b[0m ${msg}`);
}

/**
 * What this recorder CANNOT film, stated up front and again at the end, and
 * mirrored into `summary.json`.
 *
 * Neither of these is a missing feature and neither is a state that could be
 * manufactured with more patience: one is a line on a different process's
 * stdout, the other is a terminal. Saying so is the whole point — the L02
 * evidence's postmortem is about a mislabelled still.
 */
const NOT_FILMABLE = [
  {
    plan_scene: "the API log pane showing the `SMART DIFF:` line with no model line beside it",
    why:
      "That line is written with the Fastify request logger in " +
      "`server/src/modules/smart-diff/service.ts:255` and goes to the API process's stdout. " +
      "There is no pane in the web UI that renders the API's own log, so a browser " +
      "recorder has nothing to point a camera at.",
    capture_instead:
      "Text evidence: tail the API stdout while loading the Files tab and grep for " +
      "`SMART DIFF:`; the claim is that NO `REVIEW model:` or `INTENT CLASSIFIER model:` " +
      "line appears beside it.",
  },
  {
    plan_scene: "the terminal running `verify:l03` with both lanes green",
    why: "A Playwright browser recorder cannot film a terminal.",
    capture_instead: "Text evidence: `bash scripts/verify-l03.sh` output, pasted verbatim.",
  },
];

function announceNotFilmable() {
  for (const item of NOT_FILMABLE) {
    note(`NOT FILMED — ${item.plan_scene}`);
    console.log(`    why: ${item.why}`);
    console.log(`    instead: ${item.capture_instead}`);
  }
}

async function caption(page: Page, step: number | string, text: string) {
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

async function beat(page: Page, step: number | string, text: string, ms = 3200) {
  await caption(page, step, text);
  await sleep(ms);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(OUT, `${String(++shotNo).padStart(2, "0")}-${name}.png`) });
}

/**
 * Wait, scroll, settle — for something that is already near the top of the page.
 *
 * `scrollIntoViewIfNeeded` is a no-op when the element is already visible, which
 * is what keeps the section label and the summary strip in the same frame
 * instead of yanking the strip to the middle of the screen.
 */
async function ensureVisible(loc: Locator, timeout = 30_000): Promise<Locator> {
  await loc.waitFor({ timeout });
  await loc.scrollIntoViewIfNeeded();
  await sleep(500);
  return loc;
}

/**
 * Wait, scroll, settle — for something far down a very long page.
 *
 * `scrollIntoViewIfNeeded` only guarantees visibility AT THE VIEWPORT EDGE, and
 * this recording pins a caption bar to the bottom of the window — so an element
 * scrolled to the bottom edge ends up BEHIND the caption. The native
 * `scrollIntoView({block: "center"})` afterwards is what actually frames it, and
 * it scrolls every scrollable ancestor, so it works on inner panes too.
 * `page.mouse.wheel()` is not an option: it scrolls whatever is under the
 * cursor, and the cursor starts at (0,0) over the sidebar
 * (`demo/INSIGHTS.md`, 2026-07-31).
 */
async function frame(loc: Locator, block: ScrollLogicalPosition = "center", timeout = 30_000): Promise<Locator> {
  await loc.waitFor({ timeout });
  await loc.scrollIntoViewIfNeeded();
  await loc.evaluate((el, b) => el.scrollIntoView({ block: b as ScrollLogicalPosition, inline: "nearest" }), block);
  await sleep(700);
  return loc;
}

/**
 * The card wrapping a file's header — `span.filePath → div.fileHeader → div.fileCard`.
 *
 * NOT `getByText(path).first()`: every non-boilerplate file is expanded in smart
 * mode, so ~10 000 diff lines are in the DOM, and a workflow or a doc that
 * merely MENTIONS `client/pnpm-lock.yaml` puts that exact string on a code line
 * earlier in the page than the lock-file's own header. `.first()` would then
 * frame a random line of someone else's diff and the collapsed-body assertion
 * below would read a code row's child count.
 *
 * The header is told apart structurally: `FileCard` leads with
 * `<Icon.ChevronRight>`, so the path span's parent's first child is an `<svg>`.
 * A `CodeLine` row leads with the finding rail or the gutter number — always a
 * `<span>`, never an icon.
 */
async function fileCardFor(page: Page, path: string): Promise<Locator | null> {
  const matches = page.getByText(path, { exact: true });
  const n = await matches.count();
  for (let i = 0; i < n; i++) {
    const el = matches.nth(i);
    const isHeader = await el
      .evaluate((node) => node.parentElement?.firstElementChild?.tagName.toLowerCase() === "svg")
      .catch(() => false);
    if (isHeader) return el.locator("xpath=../..");
  }
  return null;
}

/** As above, but a missing card is a broken precondition rather than a maybe. */
async function requireFileCard(page: Page, path: string): Promise<Locator> {
  const card = await fileCardFor(page, path);
  if (!card) throw new Error(`No file-card header for ${path} — it is not rendered on this screen.`);
  return card;
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
 * Poll the API, never the DOM: it reports WHY a run failed, where a DOM wait can
 * only time out. Stuck runs are cancelled before bailing so the next take does
 * not start against a wedged stack — though a cancel only marks the row, and a
 * slow provider call still bills for whatever it eventually returns.
 *
 * This recorder needs no trace, so there is deliberately nothing trace-shaped
 * here: terminal status on `GET /pulls/:id/runs` is the whole finish line.
 */
async function waitForRuns(
  prId: string,
  runIds: string[],
  onTick?: (settled: number, total: number, elapsedMs: number) => Promise<void>,
): Promise<RunSummary[]> {
  const started = Date.now();
  const deadline = started + RUN_TIMEOUT;
  for (;;) {
    const runs = (await api<RunSummary[]>(`/pulls/${prId}/runs`)).filter((r) => runIds.includes(r.run_id));
    const settled = runs.filter((r) => TERMINAL.has(r.status ?? "")).length;
    if (runs.length === runIds.length && settled === runIds.length) return runs;
    if (Date.now() > deadline) {
      const stuck = runs.filter((r) => !TERMINAL.has(r.status ?? ""));
      for (const r of stuck) await api(`/runs/${r.run_id}/cancel`, { method: "POST" }).catch(() => {});
      throw new Error(
        `Runs did not settle within ${RUN_TIMEOUT}ms (cancelled) — stuck on: ` +
          stuck.map((r) => r.agent_name).join(", "),
      );
    }
    if (onTick) await onTick(settled, runIds.length, Date.now() - started);
    await sleep(4000);
  }
}

/** Open the Run Review dropdown and start EVERY enabled agent, returning run ids. */
async function triggerAllAgents(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: /Run Review/i }).click();
  const runAll = page.getByRole("button", { name: "Run all enabled agents" });
  await runAll.waitFor({ timeout: 10_000 });
  const started = page.waitForResponse(
    (r) => r.url().includes("/review") && r.request().method() === "POST",
    { timeout: 120_000 },
  );
  await runAll.click();
  const res = await started;
  return ((await res.json()) as { runs: { run_id: string }[] }).runs.map((r) => r.run_id);
}

function totalsOf(sd: SmartDiff) {
  let files = 0;
  let findings = 0;
  let lines = 0;
  for (const g of sd.groups) {
    for (const f of g.files) {
      files += 1;
      findings += f.findings.length;
      lines += f.additions + f.deletions;
    }
  }
  return { files, findings, lines };
}

/**
 * Everything that can make a scene unfilmable, checked BEFORE the browser opens
 * and therefore before a cent is spent.
 *
 * The alternative — discovering at scene 5 that this PR has no lock-file — costs
 * the whole take, because scenes 7-10 have already been paid for by then. A free
 * probe ahead of a paid take is the cheap habit in this package
 * (`demo/INSIGHTS.md`, 2026-08-06).
 */
async function preflight(pull: Pull) {
  const detail = await api<PrDetail>(`/pulls/${pull.id}`);
  const withPatch = detail.files.filter((f) => f.patch != null && f.patch.length > 0).length;
  if (withPatch === 0) {
    throw new Error(
      `Every file on ${REPO_NAME}#${pull.number} has patch: null — this is seed data. ` +
        "No diff body renders, no finding can anchor to a line, and the per-line rail cannot be filmed. " +
        "Point DEMO_REPO/DEMO_PR at a genuinely imported PR.",
    );
  }
  if (withPatch < detail.files.length) {
    warn(`${detail.files.length - withPatch} of ${detail.files.length} files carry no patch — their bodies will render as "no diff text".`);
  }

  const sd = await api<SmartDiff>(`/pulls/${pull.id}/smart-diff`);
  const totals = totalsOf(sd);

  const first = sd.groups[0];
  if (!first || first.role !== "core") {
    throw new Error(
      `Scene 4 needs Core logic on top; the payload's first group is \`${first?.role ?? "(none)"}\`. ` +
        "Either this PR changed no core file, or the server's ROLE_ORDER regressed.",
    );
  }

  const boilerplate = sd.groups.find((g) => g.role === "boilerplate");
  const lockFile = boilerplate?.files.find((f) => LOCK_FILE.test(f.path));
  if (!lockFile) {
    const strays = sd.groups
      .filter((g) => g.role !== "boilerplate")
      .flatMap((g) => g.files.filter((f) => LOCK_FILE.test(f.path)).map((f) => `${f.path} → ${g.role}`));
    throw new Error(
      strays.length
        ? `A lock-file is always Boilerplate, and this payload disagrees: ${strays.join(", ")}. That is the acceptance criterion failing, not a recording problem.`
        : `PR #${pull.number} changes no lock-file, so scene 5 has nothing to film. PR #5 has none either — pick a PR that touches one.`,
    );
  }

  const large =
    sd.groups.flatMap((g) => g.files.filter((f) => f.is_large).map((f) => ({ ...f, role: g.role }))).at(0) ?? null;
  if (!large) {
    throw new Error(`No file on PR #${pull.number} is flagged \`is_large\`, so scene 6 has no chip to film.`);
  }

  if (!sd.split_suggestion.too_big) {
    warn(
      `split_suggestion.too_big is false (${sd.split_suggestion.total_lines} changed lines) — ` +
        "scene 3 will film the summary strip WITHOUT the large-PR banner.",
    );
  }
  if (totals.findings > 0) {
    warn(
      `This PR already carries ${totals.findings} finding(s). Scene 1's "no findings in original order" is then ` +
        "a weaker claim, and scene 8 shows badges CHANGING rather than APPEARING. Scene 11 still holds.",
    );
  }

  const agents = await api<Agent[]>("/agents");
  const enabled = agents.filter((a) => a.enabled);
  if (enabled.length === 0) {
    throw new Error("No agent is enabled — `Run all enabled agents` would start nothing and scene 7 would film an idle page.");
  }

  return { detail, smartDiff: sd, totals, lockFile, large, enabled };
}

async function main() {
  console.log("");
  warn("THIS RECORDING SPENDS REAL MONEY: one review trigger, every enabled agent, sequentially.");
  warn("Do NOT run any package's test suite while it is in flight — the orphan-run reaper will kill the live run.");
  console.log("");
  announceNotFilmable();
  console.log("");

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

  const pre = await preflight(pull);
  log(`target: ${repo.full_name} #${pull.number} — ${pull.title}`);
  log(
    `${pre.totals.files} files · ${pre.totals.lines} changed lines · ${pre.totals.findings} finding(s) today · ` +
      `groups: ${pre.smartDiff.groups.map((g) => `${g.role}(${g.files.length})`).join(" → ")}`,
  );
  log(`lock-file: ${pre.lockFile.path} (+${pre.lockFile.additions} −${pre.lockFile.deletions}) → boilerplate ✓`);
  log(`large file: ${pre.large.path} (+${pre.large.additions} −${pre.large.deletions}) in ${pre.large.role}`);
  log(`agents to run: ${pre.enabled.map((a) => `${a.name} (${a.model})`).join(", ")}`);

  let browser: Browser | undefined;
  let ctx: BrowserContext | undefined;
  const scenes: { n: number; name: string; filmed: boolean; note?: string }[] = [];
  const record = (n: number, name: string, filmed: boolean, sceneNote?: string) => {
    scenes.push({ n, name, filmed, ...(sceneNote ? { note: sceneNote } : {}) });
  };

  /**
   * A broken claim AFTER the money has been spent.
   *
   * Before the trigger, a failed precondition throws: the take is free to redo.
   * After it, throwing would discard the footage the runs were paid for AND the
   * summary that says what went wrong — so from scene 7 onward a failure is
   * recorded loudly, carried into `summary.json`, and the process still exits
   * non-zero. A quietly short video is the failure mode this package's
   * conventions already forbid; a loudly annotated one is the alternative.
   */
  const failures: string[] = [];
  const fail = (msg: string) => {
    warn(msg);
    failures.push(msg);
  };

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

    // ---- Scene 1: original order, no findings on any line ------------------

    await page.goto(`${prUrl}?tab=diff&view=original`, { waitUntil: "networkidle" });
    // 100 files with real patches is a lot of DOM; give React room to land it.
    await sleep(2500);
    await ensureVisible(page.getByText(`Files changed · ${pre.detail.files_count} files`, { exact: false }));
    await beat(
      page,
      1,
      `Original order — the order the API returns. ${pre.detail.files_count} files, no roles, no findings on any line`,
      4200,
    );
    await shot(page, "original-order");
    record(
      1,
      "Files changed in original order",
      true,
      pre.totals.findings === 0
        ? "Filmed BEFORE any review, so this frame alone does not prove findings are hidden in original mode — scene 11 is the frame that does."
        : undefined,
    );

    // ---- Scene 2: toggle to smart order ------------------------------------

    await page.getByRole("button", { name: "Smart order", exact: true }).click();
    await page.getByText("Smart Diff · grouped by role", { exact: true }).waitFor({ timeout: 30_000 });
    await sleep(2000);
    await beat(page, 2, "One toggle — the same files, grouped by the role each one plays in the change", 4200);
    await shot(page, "smart-order");
    record(2, "Toggle to Smart order, section label flips", true);

    // ---- Scene 3: the summary strip and the large-PR banner ----------------

    await ensureVisible(page.getByText(/changed lines?$/).first());
    await beat(
      page,
      3,
      `${pre.totals.files} files · ${pre.totals.lines} changed lines · ${pre.totals.findings} findings — ` +
        (pre.smartDiff.split_suggestion.too_big ? "big enough that the app says so" : "under the split threshold"),
      4600,
    );
    await shot(page, "summary-strip");
    let bannerShown = false;
    if (pre.smartDiff.split_suggestion.too_big) {
      const banner = page.getByText(/This PR is large \(/).first();
      bannerShown = await banner
        .isVisible()
        .catch(() => false);
      if (bannerShown) {
        await ensureVisible(banner);
        await beat(page, "3b", `"This PR is large" — ${pre.smartDiff.split_suggestion.total_lines} changed lines`, 3800);
        await shot(page, "large-pr-banner");
      } else {
        warn("the payload says too_big but the banner is not on screen — filming the strip only");
      }
    }
    record(3, "Summary strip + large-PR banner", true, bannerShown ? undefined : "banner not rendered");

    // ---- Scene 4: core logic on top ----------------------------------------

    // Framed on the DESCRIPTION, not the label: the group header holds swatch,
    // label, description and count in one div, and "Core logic" on its own is a
    // string a diff line in this very PR could contain verbatim (the label lives
    // in `messages/en/prReview.json`). The description is both more specific and
    // the thing scene 4 is supposed to show.
    const coreHeader = page
      .getByText("The substance of the change — review closely", { exact: true })
      .first()
      .locator("xpath=..");
    await frame(coreHeader, "start");
    await coreHeader.getByText("Core logic", { exact: true }).waitFor({ timeout: 15_000 });
    await beat(
      page,
      4,
      "Core logic first, with its swatch and what it means: the substance of the change — review closely",
      4600,
    );
    await shot(page, "core-on-top");
    record(4, "Core logic group on top, swatch + description", true);

    // ---- Scene 5: the lock-file in a collapsed Boilerplate group -----------

    const boilerplateHeader = page
      .getByText("Generated / mechanical — skim", { exact: true })
      .first()
      .locator("xpath=..");
    await frame(boilerplateHeader, "start");
    await boilerplateHeader.getByText("Boilerplate", { exact: true }).waitFor({ timeout: 15_000 });
    await beat(page, 5, "Boilerplate last — generated / mechanical, skim", 3400);
    await shot(page, "boilerplate-group");

    const lockCard = await requireFileCard(page, pre.lockFile.path);
    await frame(lockCard, "center");
    // The claim, checked rather than filmed: the lock-file is PRESENT and its
    // body is NOT rendered. `FileCard` renders exactly one child (the header)
    // while collapsed and two (header + body) once open, so the count is the
    // cheapest honest read of "collapsed" available from outside React.
    const lockChildren = await lockCard.evaluate((el) => el.childElementCount);
    if (lockChildren !== 1) {
      throw new Error(
        `${pre.lockFile.path} is in the Boilerplate group but its card has ${lockChildren} children — ` +
          "it rendered its body, so it did not start collapsed. That is the acceptance criterion failing.",
      );
    }
    await beat(
      page,
      "5b",
      `${pre.lockFile.path} — +${pre.lockFile.additions} −${pre.lockFile.deletions}, always Boilerplate, and closed until you ask`,
      5000,
    );
    await shot(page, "lockfile-collapsed");
    record(5, "Lock-file inside a collapsed Boilerplate group", true, "asserted: card has exactly one child, so no body");

    // ---- Scene 6: a large file's chip --------------------------------------

    const largeCard = await requireFileCard(page, pre.large.path);
    await frame(largeCard, "center");
    await largeCard.getByText("large file", { exact: true }).waitFor({ timeout: 15_000 });
    await beat(
      page,
      6,
      `${pre.large.path} — +${pre.large.additions} −${pre.large.deletions}: flagged \`large file\` before anyone opens it`,
      4800,
    );
    await shot(page, "large-file-chip");
    record(6, "A large file's `large file` chip", true);

    // ---- Scene 7: THE MONEY ------------------------------------------------

    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(600);
    await beat(
      page,
      7,
      `Run Review → all ${pre.enabled.length} enabled agents, one after another. This is the only step that costs anything`,
      3600,
    );
    const runIds = await triggerAllAgents(page);
    log(`started ${runIds.length} run(s): ${runIds.map((i) => i.slice(0, 8)).join(", ")}`);
    record(7, "Run Review → every enabled agent", true, `${runIds.length} run(s)`);

    // Triggering switches the app to `?tab=findings` on its own (`onRunStart`),
    // which is a client-side route change — and a route change wipes the
    // injected caption node, so it is re-created rather than assumed.
    await page
      .waitForURL(/tab=findings/, { timeout: 30_000 })
      .catch(() => fail("the app did not switch to the Agent runs tab after the trigger — the Live Log is not on screen"));
    await sleep(1500);

    // The marker goes in AFTER the navigation the app performs and BEFORE the
    // wait: everything from here to scene 8's screenshot must happen without a
    // reload, and this is what proves it did.
    await page.evaluate((k) => {
      (window as unknown as Record<string, number>)[k] = Date.now();
    }, RELOAD_MARKER);

    await caption(page, 8, `${runIds.length} agents, sequentially — the Live Log streams each one`);
    const logTail = page
      .getByPlaceholder("Filter log…")
      .locator("xpath=../../..")
      .locator("div.mono")
      .last();

    const runs = await waitForRuns(pull.id, runIds, async (settled, total, elapsed) => {
      const mins = Math.floor(elapsed / 60_000);
      const secs = Math.floor((elapsed % 60_000) / 1000);
      await caption(
        page,
        8,
        `${settled} of ${total} agents finished · ${mins}m ${String(secs).padStart(2, "0")}s — ` +
          "no model is involved in the grouping itself; these are the reviews",
      );
      // `LiveLogStream` is a fixed-height pane that does NOT follow its own tail,
      // so the newest line sits below the fold unless something scrolls it. Not a
      // scene, so a failure here is a warning, never a lost take.
      // Short timeout on purpose: this runs inside the poll loop, and the
      // default 30 s would stall the caption heartbeat every tick on a page
      // where the pane has not mounted.
      await logTail.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    });

    const failed = runs.filter((r) => r.status === "failed");
    for (const r of failed) warn(`${r.agent_name} failed`);
    console.table(
      runs.map((r) => ({ agent: r.agent_name, status: r.status, findings: r.findings_count, score: r.score, cost: r.cost_usd })),
    );

    // ---- Scene 8: badges and rails, with no reload -------------------------

    // The client has to NOTICE the runs finished before the tab is switched:
    // `RunStatus.onDone` is what fires `invalidateRuns.smartDiff()`, and it lives
    // inside the Live-review section that unmounts once no run is active. Switch
    // tabs too early and the invalidation never happens.
    await page
      .getByText("Review in progress…", { exact: false })
      .waitFor({ state: "hidden", timeout: 180_000 })
      .catch(() => warn("the in-progress banner never cleared — the client may not have seen the runs settle"));
    await sleep(4000);

    const after = await api<SmartDiff>(`/pulls/${pull.id}/smart-diff`);
    const afterTotals = totalsOf(after);
    log(`after the run: ${afterTotals.findings} finding(s) across ${afterTotals.files} files`);
    if (afterTotals.findings === 0) {
      warn("The review produced NO findings — there are no badges or rails to film, and scenes 8-11 will be empty.");
    }

    await beat(page, 8, "The runs are done. Back to Files changed — a tab click, not a reload", 3200);
    // A TAB CLICK, never `page.goto` and never `reload()`. The whole criterion is
    // that the badges arrive in the session that is already open.
    const smartDiffRefetch = page
      .waitForResponse((r) => r.url().includes("/smart-diff") && r.request().method() === "GET", { timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    await page.getByRole("button", { name: /^Files changed/ }).click();
    const refetched = await smartDiffRefetch;
    await page.getByText("Smart Diff · grouped by role", { exact: true }).waitFor({ timeout: 30_000 });
    await sleep(2500);

    const markerAlive = await page.evaluate(
      (k) => (window as unknown as Record<string, number | undefined>)[k] ?? null,
      RELOAD_MARKER,
    );
    if (markerAlive == null) {
      fail(
        "The no-reload marker is GONE: the page reloaded between starting the run and the badge shot, " +
          "so this footage does not support the claim scene 8 exists to make. Do not present it as if it did.",
      );
    } else {
      log(`no-reload marker survived (set ${Math.round((Date.now() - markerAlive) / 1000)}s ago) ✓`);
    }

    // Find a file whose findings anchor to rendered lines — that is the only
    // place both the rail and the clickable severity tag exist. Core first: its
    // group is expanded, so nothing has to be opened first.
    const ranked = [...after.groups].sort(
      (a, b) => ["core", "wiring", "boilerplate"].indexOf(a.role) - ["core", "wiring", "boilerplate"].indexOf(b.role),
    );
    const candidates = ranked.flatMap((g) => g.files.filter((f) => f.findings.length > 0).map((f) => ({ ...f, role: g.role })));
    log(`files carrying findings: ${candidates.map((c) => `${c.path}(${c.findings.length})`).join(", ") || "(none)"}`);

    let tag: Locator | null = null;
    let tagFile: (typeof candidates)[number] | null = null;
    for (const cand of candidates) {
      const card = await fileCardFor(page, cand.path);
      if (!card) continue;
      await frame(card, "center").catch(() => {});
      // A LINE tag's whole text is the severity word (`blocker` / `warning` /
      // `suggestion`, `findings.ts:severityTagLabel`). The unanchored chip below
      // the diff uses the same aria-label but reads `blocker · <title>`, so the
      // anchored one is the one whose text is nothing but the word.
      const lineTag = card
        .getByRole("button", { name: /^Open finding: / })
        .filter({ hasText: /^(blocker|warning|suggestion)$/ })
        .first();
      if ((await lineTag.count()) > 0) {
        tag = lineTag;
        tagFile = cand;
        break;
      }
    }

    if (!tag || !tagFile) {
      warn("No finding anchored to a rendered line — no rail and no clickable line tag to film (scenes 8-10 degraded).");
      await beat(page, 8, "Findings from the run, joined onto the same files — no page reload", 4600);
      await shot(page, "badges-no-reload");
      record(8, "Badges/rails appear with no reload", false, "no line-anchored finding; only file badges are visible");
    } else {
      await frame(tag, "center");
      await beat(
        page,
        8,
        `${afterTotals.findings} findings, on the same screen and with no reload — badges on the files, rails on the lines`,
        5200,
      );
      await shot(page, "badges-no-reload");
      record(8, "Badges/rails appear with no reload", true, `marker survived; smart-diff refetched on tab click: ${refetched}`);
    }

    // ---- Scene 9: click a finding's severity tag ---------------------------

    let clicked: { id: string; url: string; run_id: string | null; expanded: boolean } | null = null;
    if (tag && tagFile) {
      // Everything from here is post-money, so a broken claim is RECORDED, not
      // thrown: throwing would take the footage down with it.
      try {
        await beat(page, 9, "Click the tag on the line — the finding is one click from the code it is about", 3000);
        await tag.click();
        await page.waitForURL(/finding=/, { timeout: 30_000 });
        const url = page.url();
        const findingId = new URL(url).searchParams.get("finding");
        if (!findingId) throw new Error(`Clicked a finding tag and the URL carries no \`finding\` param: ${url}`);
        if (!/tab=findings/.test(url)) throw new Error(`The click did not land on the Agent runs tab: ${url}`);

        const reviews = await api<ReviewRecord[]>(`/pulls/${pull.id}/reviews`);
        const owning = reviews.find((rv) => rv.findings.some((f) => f.id === findingId)) ?? null;

        const card = page.locator(`[data-finding-id="${findingId}"]`);
        await card.waitFor({ timeout: 30_000 });
        await sleep(1500);
        // Expanded, not merely present: the body — and with it the Accept action
        // — renders only when the card is open, which is what the deep link
        // promises. Presence alone would pass on a card the reader still has to
        // click.
        const expanded = (await card.getByRole("button", { name: /^Accept/ }).count()) > 0;
        if (!expanded) fail("the finding's card is on screen but NOT expanded — `expandNonce` did not reach it");
        if (owning?.run_id) {
          const accordion = page.locator(`#review-run-${owning.run_id}`);
          const inside = await accordion.locator(`[data-finding-id="${findingId}"]`).count();
          if (inside === 0) fail(`the owning accordion (#review-run-${owning.run_id}) did not open around the card`);
        }
        await frame(card, "center");
        await beat(
          page,
          9,
          `?tab=findings&finding=… — the Agent runs tab, ${owning?.agent_name ?? "the owning run"}'s accordion open, that card expanded`,
          5400,
        );
        await shot(page, "finding-deep-link");
        clicked = { id: findingId, url, run_id: owning?.run_id ?? null, expanded };
        record(9, "Finding click-through to its card", true, expanded ? undefined : "card not expanded");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        fail(`scene 9 (finding click-through) failed: ${msg}`);
        record(9, "Finding click-through to its card", false, msg);
      }

      // ---- Scene 10: Back, still in Smart mode -----------------------------

      if (clicked) {
        try {
          await beat(page, 10, "Back — and the Files tab is exactly where it was, still in Smart order", 3000);
          await page.goBack();
          await page.waitForURL(/tab=diff/, { timeout: 30_000 });
          const backUrl = page.url();
          const backView = new URL(backUrl).searchParams.get("view");
          if (backView !== "smart") {
            throw new Error(`Back landed on view=${backView ?? "(absent)"}, not smart: ${backUrl}`);
          }
          await page.getByText("Smart Diff · grouped by role", { exact: true }).waitFor({ timeout: 30_000 });
          await sleep(2200);
          await beat(page, 10, `${backUrl.replace(BASE, "")} — the ordering survived the round trip`, 4600);
          await shot(page, "back-to-smart");
          record(10, "Back returns to ?tab=diff&view=smart", true);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          fail(`scene 10 (Back → smart) failed: ${msg}`);
          record(10, "Back returns to ?tab=diff&view=smart", false, msg);
        }
      } else {
        record(10, "Back returns to ?tab=diff&view=smart", false, "scene 9 did not complete");
      }
    } else {
      record(9, "Finding click-through to its card", false, "no line-anchored finding to click");
      record(10, "Back returns to ?tab=diff&view=smart", false, "scene 9 did not run");
    }

    // ---- Scene 11 (free): original order, now that findings EXIST ----------
    //
    // Scene 1 films original mode before any review, where "no findings" is
    // true by arithmetic rather than by design. This is the frame that carries
    // the criterion: the same PR, the same session, findings in the database,
    // and original mode still showing none — because `DiffViewer` has no prop to
    // receive them (`components/diff-viewer/findings.ts:9-12`).

    let strayTags = -1;
    let stillNoReload: number | null = null;
    try {
      // Scene 9 may have left the browser on the Agent runs tab. Get back with a
      // TAB CLICK, never a `goto` — the marker has to survive to the end.
      if (!/tab=diff/.test(page.url())) {
        await page.getByRole("button", { name: /^Files changed/ }).click();
        await page.waitForURL(/tab=diff/, { timeout: 30_000 });
        await sleep(1500);
      }
      await page.getByRole("button", { name: "Original order", exact: true }).click();
      await page.getByText(/^Files changed · /).first().waitFor({ timeout: 30_000 });
      await sleep(2500);
      strayTags = await page.getByRole("button", { name: /^Open finding: / }).count();
      stillNoReload = await page.evaluate(
        (k) => (window as unknown as Record<string, number | undefined>)[k] ?? null,
        RELOAD_MARKER,
      );
      if (strayTags > 0) {
        fail(`Original order is showing ${strayTags} finding tag(s) — findings are supposed to be unreachable in that mode.`);
      }
      await beat(
        page,
        11,
        `Original order again — ${afterTotals.findings} findings exist now, and not one of them is on this screen`,
        5200,
      );
      await shot(page, "original-order-after-review");
      record(
        11,
        "Original order after the review still shows no findings",
        strayTags === 0,
        "ADDED beyond the plan's list, and free: scene 1 is filmed before any review exists, so on its own it cannot carry this criterion",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fail(`scene 11 (original order after the review) failed: ${msg}`);
      record(11, "Original order after the review still shows no findings", false, msg);
    }

    const summary = {
      recorded_at: new Date().toISOString(),
      repo: repo.full_name,
      pr: pull.number,
      pr_id: pull.id,
      pr_title: pull.title,
      pr_status: pre.detail.status,
      files: {
        count: pre.detail.files_count,
        with_patch: pre.detail.files.filter((f) => f.patch != null && f.patch.length > 0).length,
      },
      smart_diff_before: {
        groups: pre.smartDiff.groups.map((g) => ({ role: g.role, files: g.files.length })),
        findings: pre.totals.findings,
        changed_lines: pre.totals.lines,
        too_big: pre.smartDiff.split_suggestion.too_big,
        lock_file: { path: pre.lockFile.path, additions: pre.lockFile.additions, deletions: pre.lockFile.deletions },
        large_file: { path: pre.large.path, role: pre.large.role, additions: pre.large.additions, deletions: pre.large.deletions },
      },
      smart_diff_after: {
        groups: after.groups.map((g) => ({ role: g.role, files: g.files.length })),
        findings: afterTotals.findings,
      },
      no_reload_proof: {
        marker_survived: markerAlive != null,
        marker_still_alive_after_scene_11: stillNoReload != null,
        smart_diff_refetched_on_tab_click: refetched,
        /* What the footage does and does not settle. The badges arrive with no
           reload — that is filmed and the marker proves it. WHICH mechanism
           delivered them is NOT settled here: the global `staleTime` is 30 s
           (`client/src/lib/providers.tsx:28`) and these runs take minutes, so the
           query was stale by the time the tab was clicked whether or not S6's
           invalidator fired. Distinguishing the two needs a run shorter than the
           stale window, which is not something this recorder can arrange. */
        caveat:
          "No reload occurred (marker intact). Whether S6's invalidator or the 30s staleTime triggered the refetch is not distinguished by this take.",
      },
      finding_clicked: clicked,
      original_mode_finding_tags_after_review: strayTags,
      scenes,
      /** Claims that did not hold, verbatim. Empty is the only good value. */
      failures,
      not_filmable: NOT_FILMABLE,
      agents: pre.enabled.map((a) => ({ name: a.name, model: a.model })),
      runs: runs.map((r) => ({
        run_id: r.run_id,
        agent: r.agent_name,
        status: r.status,
        model: r.model,
        cost_usd: r.cost_usd,
        findings: r.findings_count,
        score: r.score,
      })),
      total_cost_usd: runs.every((r) => r.cost_usd != null)
        ? runs.reduce((n, r) => n + (r.cost_usd ?? 0), 0)
        : null,
    };
    writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));

    await page.close();
    await ctx.close();
    ctx = undefined;

    const raw = await page.video()?.path();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const final = join(OUT, `devdigest-smart-diff-${stamp}.webm`);
    if (raw) renameSync(raw, final);
    const mp4 = raw ? toMp4(final) : null;

    console.log("");
    log(`\x1b[32m✓ video:\x1b[0m ${mp4 ?? (raw ? final : "(not recorded)")}`);
    log(`\x1b[32m✓ frames + summary.json:\x1b[0m ${OUT}`);
    const skipped = scenes.filter((sc) => !sc.filmed);
    if (skipped.length) warn(`scenes not filmed: ${skipped.map((sc) => `${sc.n} (${sc.note ?? "?"})`).join("; ")}`);
    if (failures.length) {
      console.log("");
      warn(`${failures.length} claim(s) did not hold — the video is NOT clean evidence for them:`);
      for (const f of failures) console.warn(`    - ${f}`);
    }
    console.log("");
    note("Still to capture as TEXT evidence — this recorder cannot film either:");
    announceNotFilmable();
    if (failed.length || failures.length) process.exitCode = 1;
  } finally {
    await ctx?.close();
    await browser?.close();
  }
}

main().catch((err) => {
  console.error(`\x1b[31m✗ ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
  process.exit(1);
});

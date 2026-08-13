/**
 * DevDigest screencast recorder — L04 homework: Blast Radius.
 *
 * Seven scenes, in one unedited take:
 *
 *   1. The Blast tab on a PR that changes a SHARED HELPER — counts, and the
 *      commit the map was computed at.
 *   2. The changed symbol with the widest reach, its callers under it.
 *   3. A caller's `file:line`, framed close, with the URL it carries asserted
 *      against the map's own data before the click.
 *   4. That link followed for real, into a second tab: github.com, the file, the
 *      `#L<n>` fragment, and the source line highlighted.
 *   5. Back on the tab: the HTTP routes, with `in a changed file` and
 *      `N hops downstream` telling two different strengths of claim apart.
 *   6. A PR in an UNINDEXED repository → the degraded state, which offers
 *      Re-analyze and does not claim there are no callers.
 *   7. The API's own log line for the request just made: index tables read,
 *      `llm_calls: 0`.
 *
 * SCENE 4 IS THE ONE THAT COSTS EFFORT AND THE ONE WORTH HAVING. "Clickable
 * `file:line`" is an acceptance criterion, and a recorder that films the link
 * and stops has filmed an `<a>` tag, not a working deep link. The click is
 * followed into GitHub and the landing URL is asserted, so the frame proves the
 * reviewer arrives at the right line rather than merely that something is
 * underlined. It is also the only network egress in this recorder.
 *
 * SCENE 7 IS FILMED FROM A FILE, NOT A PANE, and says so on screen. The proof
 * that this endpoint reads the index instead of re-parsing the repository is a
 * line on the API process's stdout; no pane in the web UI renders it. The
 * recorder tails the log the caller points it at and screenshots the terminal
 * text rendered into a page — labelled as such. When no log path is given the
 * scene is SKIPPED and recorded as skipped, never staged.
 *
 * THIS RECORDER TRIGGERS NO REVIEW AND SPENDS NOTHING. Blast Radius makes no
 * model call by construction, which is half of what it is for; a recorder that
 * ran an agent would be filming a different feature and would make the cost
 * claim unverifiable in the same breath as it was made.
 *
 * A broken claim THROWS. Nothing here costs money, so a take is free to redo and
 * a loud failure is strictly better than a video whose caption lies.
 *
 * Prereqs: the dev stack is up (`../scripts/dev.sh`), `npm run setup` has
 * fetched Chromium, DEMO_REPO is INDEXED (`status: full` or `partial`), and
 * DEMO_PR changes a file declaring a symbol with at least two callers. The
 * preflight refuses to launch the browser when any of that is missing, and it
 * names which one.
 *
 * Env (all optional):
 *   DEMO_BASE_URL   web origin         default http://localhost:3000
 *   DEMO_API_URL    API origin         default http://localhost:3001
 *   DEMO_OUT        output dir         default ./recordings/l04-blast
 *   DEMO_REPO       repo full_name     default teplyakoff/dev-digest
 *   DEMO_PR         PR number          default 4
 *   DEMO_BARE_REPO  unindexed repo     default acme/payments-api
 *   DEMO_API_LOG    API stdout log for scene 7 (skipped when unset)
 *   DEMO_HEADED     "1" to watch       default headless
 *
 * Usage:
 *   npm run record:blast
 */
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const API = process.env.DEMO_API_URL ?? "http://localhost:3001";
const OUT = process.env.DEMO_OUT ?? join(HERE, "recordings", "l04-blast");
const REPO_NAME = process.env.DEMO_REPO ?? "teplyakoff/dev-digest";
const PR_NUMBER = Number(process.env.DEMO_PR ?? 4);
const BARE_REPO = process.env.DEMO_BARE_REPO ?? "acme/payments-api";
const API_LOG = process.env.DEMO_API_LOG ?? null;
const HEADED = process.env.DEMO_HEADED === "1";

const VIEWPORT = { width: 1280, height: 720 };
const CAPTION_ID = "__devdigest_caption";
/** How much of the viewport bottom the caption bar covers. */
const CAPTION_BAND = 64;

/** The minimum the acceptance criterion asks the map to show on the demo PR. */
const MIN_CALLERS = 2;
const MIN_ENDPOINTS = 1;

interface Repo { id: string; full_name: string }
interface Pull { id: string; number: number; title: string }
interface IndexState { status: string; filesIndexed: number; lastIndexedSha: string }
interface BlastCaller { file: string; symbol: string; line: number; rank: number }
interface BlastSymbol {
  name: string;
  file: string;
  kind: string;
  callers: BlastCaller[];
  callers_total: number;
}
interface BlastEndpoint { route: string; file: string; depth: number; via: string }
interface BlastResponse {
  status: "full" | "partial" | "degraded";
  reason: string | null;
  changed_files: string[];
  symbols: BlastSymbol[];
  endpoints: BlastEndpoint[];
  crons: { name: string; file: string; depth: number; via: string }[];
  indexed_sha: string | null;
  counts: { symbols: number; callers: number; endpoints: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let shotNo = 0;

function log(msg: string) {
  console.log(`\x1b[36m•\x1b[0m ${msg}`);
}
function warn(msg: string) {
  console.warn(`\x1b[33m!\x1b[0m ${msg}`);
}
function note(msg: string) {
  console.log(`\x1b[35m▸\x1b[0m ${msg}`);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
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

async function beat(page: Page, step: number | string, text: string, ms = 3400) {
  await caption(page, step, text);
  await sleep(ms);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(OUT, `${String(++shotNo).padStart(2, "0")}-${name}.png`) });
}

/**
 * Wait, scroll, settle — and frame it in the MIDDLE, not at the viewport edge.
 *
 * `scrollIntoViewIfNeeded` only guarantees visibility at the edge, and a caption
 * bar is pinned to the bottom of this recording, so an element scrolled to the
 * bottom edge lands behind it. `demo/INSIGHTS.md` has the full version of this;
 * `page.mouse.wheel()` is not an alternative because the cursor starts over the
 * sidebar and would scroll that instead.
 */
async function frame(loc: Locator, block: ScrollLogicalPosition = "center", timeout = 30_000): Promise<Locator> {
  await loc.waitFor({ timeout });
  await loc.scrollIntoViewIfNeeded();
  await loc.evaluate((el, b) => el.scrollIntoView({ block: b as ScrollLogicalPosition, inline: "nearest" }), block);
  await sleep(700);
  return loc;
}

/**
 * Is this element VISIBLE to the viewer, rather than merely inside the
 * viewport's coordinate range?
 *
 * `box.y >= 0` is a different question, and answering that one instead shipped a
 * broken still in L03: the PR page's sticky header is ~350 px tall, so an
 * element under it reports a positive `y` and is invisible. Hit-test the
 * element's own centre and require the DOM to hand back the element itself.
 */
async function onScreen(loc: Locator): Promise<boolean> {
  const box = await loc.boundingBox();
  if (!box) return false;
  if (box.y < 0 || box.y + box.height > VIEWPORT.height - CAPTION_BAND) return false;
  return loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  });
}

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

interface Preflight {
  repo: Repo;
  pull: Pull;
  state: IndexState;
  map: BlastResponse;
  /** The symbol the take is built around: most callers, ties broken by name. */
  hero: BlastSymbol;
  bare: { repo: Repo; pull: Pull; map: BlastResponse } | null;
}

/**
 * Refuse to launch the browser unless the claims the captions will make are
 * already true of the data.
 *
 * Every check here corresponds to a line the video says out loud. The reason
 * they run BEFORE Playwright starts is that a failure at this stage costs three
 * seconds and a clear message, while the same failure mid-take costs a full run
 * and produces a video with a caption nobody can trust.
 */
async function preflight(): Promise<Preflight> {
  const repos = await api<Repo[]>("/repos");
  const repo = repos.find((r) => r.full_name === REPO_NAME);
  if (!repo) throw new Error(`Repo ${REPO_NAME} is not imported — add it first.`);

  const pulls = await api<Pull[]>(`/repos/${repo.id}/pulls`);
  const pull = pulls.find((p) => p.number === PR_NUMBER);
  if (!pull) throw new Error(`PR #${PR_NUMBER} is not imported into ${REPO_NAME}.`);

  const state = await api<IndexState>(`/repos/${repo.id}/index-state`);
  if (state.status !== "full" && state.status !== "partial") {
    throw new Error(
      `${REPO_NAME} has index status "${state.status}" — the map would render its degraded state. ` +
        `POST /repos/${repo.id}/resync and wait for it to finish.`,
    );
  }

  const map = await api<BlastResponse>(`/pulls/${pull.id}/blast`);
  if (map.status === "degraded") {
    throw new Error(`The map for #${PR_NUMBER} is degraded: ${map.reason}`);
  }

  const withCallers = map.symbols.filter((s) => s.callers.length > 0);
  const hero = [...withCallers].sort(
    (a, b) => b.callers.length - a.callers.length || a.name.localeCompare(b.name),
  )[0];
  if (!hero || hero.callers.length < MIN_CALLERS) {
    throw new Error(
      `The acceptance criterion is a shared helper with at least ${MIN_CALLERS} real callers; the best ` +
        `symbol on #${PR_NUMBER} has ${hero?.callers.length ?? 0} (${hero?.name ?? "none"}). Pick another PR.`,
    );
  }
  if (map.endpoints.length < MIN_ENDPOINTS) {
    throw new Error(`#${PR_NUMBER} reaches no HTTP endpoint; the criterion asks for at least ${MIN_ENDPOINTS}.`);
  }
  if (!map.indexed_sha) {
    throw new Error("The map carries no indexed_sha, so no file:line link can be pinned to a commit.");
  }

  // The degraded scene needs a repo that genuinely has no index. Optional: if it
  // is missing, scene 6 is skipped and SAID to be skipped rather than staged.
  let bare: Preflight["bare"] = null;
  const bareRepo = repos.find((r) => r.full_name === BARE_REPO);
  if (bareRepo) {
    const barePulls = await api<Pull[]>(`/repos/${bareRepo.id}/pulls`);
    const barePull = barePulls[0];
    if (barePull) {
      const bareMap = await api<BlastResponse>(`/pulls/${barePull.id}/blast`);
      if (bareMap.status === "degraded") bare = { repo: bareRepo, pull: barePull, map: bareMap };
      else warn(`${BARE_REPO} is indexed after all — scene 6 (degraded) will be skipped.`);
    }
  } else {
    warn(`${BARE_REPO} is not imported — scene 6 (degraded) will be skipped.`);
  }

  return { repo, pull, state, map, hero, bare };
}

/** The last `blast:` line the API wrote, for scene 7. */
function lastBlastLogLine(path: string): string | null {
  if (!existsSync(path)) return null;
  // eslint-disable-next-line no-control-regex
  const ANSI = /\[[0-9;]*m/g;
  const lines = readFileSync(path, "utf8").replace(ANSI, "").split("\n");
  const idx = lines.findLastIndex((l) => l.includes("blast: computed from the persistent index"));
  if (idx < 0) return null;
  // The Fastify pretty logger puts the structured fields on the lines after the
  // message, indented — take the message and its block.
  const block = [lines[idx]!];
  for (let i = idx + 1; i < lines.length && /^\s+\w+:/.test(lines[i] ?? ""); i += 1) {
    block.push(lines[i]!);
  }
  return block.join("\n");
}

async function main() {
  console.log("");
  log("This recording triggers NO review and spends NOTHING — Blast Radius makes no model call at all.");
  console.log("");

  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) {
    if (f.startsWith("page@") && f.endsWith(".webm")) rmSync(join(OUT, f), { force: true });
  }

  const pre = await preflight();
  const { repo, pull, state, map, hero } = pre;
  const heroCaller = hero.callers[0]!;
  const expectedHref =
    `https://github.com/${repo.full_name}/blob/${map.indexed_sha}/${heroCaller.file}#L${heroCaller.line}`;

  log(`target: ${repo.full_name} #${pull.number} — ${pull.title}`);
  log(`index: ${state.status}, ${state.filesIndexed} files, at ${map.indexed_sha!.slice(0, 7)}`);
  log(
    `map: ${map.counts.symbols} symbol(s) · ${map.counts.callers} caller(s) · ` +
      `${map.counts.endpoints} endpoint(s) over ${map.changed_files.length} changed file(s)`,
  );
  log(`hero symbol: ${hero.name} (${hero.file}) — ${hero.callers.length} caller(s)`);
  for (const c of hero.callers) log(`    ← ${c.file}:${c.line} in ${c.symbol}`);
  if (!pre.bare) note("scene 6 (degraded) will be SKIPPED — no unindexed repository available");
  if (!API_LOG) note("scene 7 (proof line) will be SKIPPED — set DEMO_API_LOG to the API's stdout log");

  let browser: Browser | undefined;
  let ctx: BrowserContext | undefined;
  const scenes: { n: number; name: string; note?: string }[] = [];
  const skipped: { n: number; name: string; why: string }[] = [];
  const record = (n: number, name: string, sceneNote?: string) => {
    scenes.push({ n, name, ...(sceneNote ? { note: sceneNote } : {}) });
  };

  let landedUrl: string | null = null;

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

    // ---- Scene 1: the tab, and what it was computed from -------------------
    await page.goto(`${prUrl}?tab=blast`, { waitUntil: "networkidle" });
    await sleep(1500);
    await frame(page.getByText("CHANGED SYMBOLS", { exact: false }).first(), "start");
    await beat(
      page,
      1,
      `Blast radius — ${map.counts.symbols} symbols, ${map.counts.callers} callers, ` +
        `${map.counts.endpoints} routes, read from the index at ${map.indexed_sha!.slice(0, 7)}`,
      5000,
    );
    await shot(page, "blast-tab");
    record(1, "blast-tab");

    // ---- Scene 2: the shared helper and its callers -------------------------
    const heroCard = page.locator("div").filter({ hasText: new RegExp(`^${hero.name}`) }).last();
    await frame(page.getByText(hero.name, { exact: true }).first(), "center");
    // Asserted, not eyeballed: the criterion is TWO real callers on a shared
    // helper, and a caption claiming it over a one-caller card is exactly the
    // kind of still this repo's evidence postmortems are about.
    for (const c of hero.callers) {
      const row = page.getByText(`${c.file}:${c.line}`, { exact: true }).first();
      if (!(await row.count())) {
        throw new Error(`${hero.name}'s caller ${c.file}:${c.line} is in the API response but not on screen.`);
      }
    }
    await beat(
      page,
      2,
      `${hero.name} is called from ${hero.callers.length} places — each cited by file and line, none of them guessed`,
      5200,
    );
    await shot(page, "changed-symbol-callers");
    record(2, "changed-symbol-callers", `${hero.name}: ${hero.callers.length} callers`);
    void heroCard;

    // ---- Scene 3: the link, and the URL it actually carries -----------------
    const link = page.getByRole("link", { name: `${heroCaller.file}:${heroCaller.line}` }).first();
    await frame(link, "center");
    if (!(await onScreen(link))) throw new Error("The caller link is in the DOM but not visible on screen.");
    const href = await link.getAttribute("href");
    if (href !== expectedHref) {
      throw new Error(
        `The link points at ${href}\n  expected ${expectedHref}\n` +
          "  (line numbers come from the INDEXED commit, so the link must be pinned to it, not to the PR head)",
      );
    }
    await beat(page, 3, `The caller is a link, pinned to the commit its line number came from`, 4600);
    await shot(page, "caller-link");
    record(3, "caller-link", expectedHref);

    // ---- Scene 4: follow it, for real --------------------------------------
    // The criterion is that the link OPENS THE RIGHT LINE. Filming an <a> tag
    // and stopping proves the markup, not the deep link.
    const [ghPage] = await Promise.all([ctx.waitForEvent("page"), link.click()]);
    // NO `setViewportSize` here. The popup already inherits the context's
    // viewport, and resizing it while its first navigation is in flight aborts
    // that navigation — the page lands on `chrome-error://chromewebdata/` and
    // the assertion below fails on a link that is perfectly good. Cost: one
    // take, and a convincing false accusation against the feature.
    await ghPage.waitForLoadState("domcontentloaded");
    await sleep(4000);
    landedUrl = ghPage.url();
    if (!landedUrl.startsWith(expectedHref.split("#")[0]!)) {
      throw new Error(`The click landed on ${landedUrl}, not on ${expectedHref}`);
    }
    await beat(
      ghPage,
      4,
      `…and it opens ${heroCaller.file} at line ${heroCaller.line} on GitHub — the call site itself`,
      5200,
    );
    await shot(ghPage, "caller-line-on-github");
    record(4, "caller-line-on-github", landedUrl);
    await ghPage.close();
    await page.bringToFront();
    await sleep(800);

    // ---- Scene 5: routes, and how far away they are -------------------------
    await frame(page.getByText("HTTP ROUTES THIS CHANGE TOUCHES", { exact: false }).first(), "start");
    const depths = [...new Set(map.endpoints.map((e) => e.depth))].sort();
    await beat(
      page,
      5,
      depths.length > 1
        ? "Routes in the changed files, and routes downstream of them — labelled apart, not pooled"
        : "The HTTP routes this change touches, each traced back to the file it was found in",
      5000,
    );
    await shot(page, "endpoints");
    record(5, "endpoints", `depths: ${depths.join(", ")}`);

    // ---- Scene 6: no index is not "no callers" ------------------------------
    if (pre.bare) {
      await page.goto(`${BASE}/repos/${pre.bare.repo.id}/pulls/${pre.bare.pull.number}?tab=blast`, {
        waitUntil: "networkidle",
      });
      await sleep(1800);
      const cta = page.getByRole("button", { name: /Re-analyze/i }).first();
      await cta.waitFor({ timeout: 15_000 });
      // The claim of this scene, asserted: an unindexed repository must not be
      // rendered as one that has no callers.
      const body = (await page.locator("body").innerText()).toLowerCase();
      if (body.includes("nothing else in the indexed code calls")) {
        throw new Error(
          "The degraded state is showing the empty-result copy — an unindexed repository is being " +
            "presented as one with no callers, which is the failure this state exists to prevent.",
        );
      }
      await beat(
        page,
        6,
        "A repository with no index says so, and offers to build one — it never reports “no callers”",
        5200,
      );
      await shot(page, "degraded-no-index");
      record(6, "degraded-no-index", pre.bare.map.reason ?? "");
    } else {
      skipped.push({
        n: 6,
        name: "degraded-no-index",
        why: `No unindexed repository available (${BARE_REPO} is absent or already indexed). Not staged.`,
      });
    }

    // ---- Scene 7: the proof line, filmed as text, labelled as text ----------
    const logLine = API_LOG ? lastBlastLogLine(API_LOG) : null;
    if (logLine) {
      await page.goto("about:blank");
      await page.evaluate((text) => {
        document.body.style.cssText =
          "margin:0;background:#0b0d12;color:#d6e0ff;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;padding:36px";
        const h = document.createElement("div");
        h.textContent = "API stdout — the request this video just made";
        h.style.cssText = "color:#7d8aa8;font:600 12px/1.4 ui-sans-serif;letter-spacing:.08em;text-transform:uppercase;margin-bottom:14px";
        const pre = document.createElement("pre");
        pre.textContent = text;
        pre.style.cssText = "margin:0;white-space:pre-wrap";
        document.body.append(h, pre);
      }, logLine);
      await sleep(600);
      await beat(
        page,
        7,
        "The server read index tables and called no model — its own log, not a pane in the app",
        5400,
      );
      await shot(page, "api-log-index-read");
      record(7, "api-log-index-read", "rendered from the API log file, not filmed from a UI pane");
    } else {
      skipped.push({
        n: 7,
        name: "api-log-index-read",
        why: API_LOG
          ? `No "blast: computed from the persistent index" line found in ${API_LOG}.`
          : "DEMO_API_LOG not set. The proof is a line on the API's stdout and no UI pane renders it.",
      });
    }

    const summary = {
      recorded_at: new Date().toISOString(),
      repo: repo.full_name,
      pull_request: pull.number,
      index: { status: state.status, files: state.filesIndexed, sha: map.indexed_sha },
      map: {
        status: map.status,
        changed_files: map.changed_files.length,
        counts: map.counts,
        endpoint_depths: [...new Set(map.endpoints.map((e) => e.depth))].sort(),
      },
      hero_symbol: {
        name: hero.name,
        file: hero.file,
        kind: hero.kind,
        callers: hero.callers.map((c) => ({ file: c.file, line: c.line, symbol: c.symbol })),
      },
      link_followed: { expected: expectedHref, landed: landedUrl },
      llm_calls: 0,
      scenes,
      skipped,
    };
    writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));

    await page.close();
    await ctx.close();
    ctx = undefined;

    const raw = await page.video()?.path();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const final = join(OUT, `devdigest-blast-${stamp}.webm`);
    if (raw) renameSync(raw, final);
    const mp4 = raw ? toMp4(final) : null;

    console.log("");
    log(`\x1b[32m✓ video:\x1b[0m ${mp4 ?? (raw ? final : "(not recorded)")}`);
    log(`\x1b[32m✓ frames + summary.json:\x1b[0m ${OUT}`);
    log(`\x1b[32m✓ ${scenes.length} scenes, no review triggered, nothing spent\x1b[0m`);
    for (const s of skipped) {
      note(`SKIPPED scene ${s.n} (${s.name}) — ${s.why}`);
    }
    console.log("");
  } finally {
    await ctx?.close();
    await browser?.close();
  }
}

main().catch((err) => {
  console.error(`\x1b[31m✗ ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
  process.exit(1);
});

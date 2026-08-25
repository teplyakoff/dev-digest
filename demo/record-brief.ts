/**
 * DevDigest screencast recorder — L05: the PR Why + Risk Brief.
 *
 * Six parts, one video:
 *
 *  1. The card, before anything. Overview opens on an empty brief card — a
 *     call to action, not an empty box, and not an error.
 *  2. The build. One click, one structured model call. The card fills in with
 *     the risk level as a coloured word, why/what in two sentences, the risks
 *     under it, and Review Focus as a list of files.
 *  3. The claim, checked rather than filmed. Every risk reference and every
 *     review-focus path is matched against the blast map's own file list, and
 *     no focus item carries a line number. See `assertGrounded`.
 *  4. The link. A review-focus item is activated; the changes tab opens with
 *     that file's card expanded and scrolled into frame. The URL is asserted.
 *  5. The cache. The same PR state is re-opened and the API answers from the
 *     stored row: `reused: true`, `model_calls: 0`, `derived_at` unmoved. That
 *     is an acceptance criterion of this lab, and it is the one claim a video
 *     cannot make on its own — nothing on screen distinguishes a cached card
 *     from a rebuilt one, which is the whole point of the "cached" chip.
 *  6. The rebuild. The button forces a fresh build on an unchanged head, and
 *     `derived_at` moves. One more paid call, deliberately.
 *
 * COSTS MONEY. Two brief builds (parts 2 and 6), each one structured call
 * bounded to 8 000 input tokens, plus an intent derivation if the target PR has
 * none — roughly $0.02–0.05 in total. `record:smart-diff` and `record:blast`
 * are the free ones.
 *
 * WHAT IT ASSERTS, rather than merely filming:
 *   - grounding: every cited file exists in the PR's own blast map (the lab's
 *     acceptance criterion, and the one a plausible-looking hallucination would
 *     sail past on camera);
 *   - no line numbers in review focus — the brief deliberately carries paths
 *     only, because blast line numbers are computed against the indexed sha;
 *   - the cache read spends nothing: `model_calls: 0` and an unmoved
 *     `derived_at` across a full page re-open.
 * A regression in any of the three still produces a video that looks right,
 * which is exactly why they are checks and not scenes.
 *
 * Prereqs: the dev stack is up (`../scripts/dev.sh`), `npm run setup` has
 * fetched Chromium, and the target PR is a genuinely imported one with a real
 * diff and an indexed repo — blast is what the grounding assertion reads.
 *
 * Part 1 needs the target PR to have NO brief row yet. Nothing in the product
 * deletes a brief (there is no DELETE route, by design), so a re-take against a
 * built PR films the built card instead and says so in the summary. To get the
 * empty state back:
 *
 *   docker exec devdigest-postgres psql -U devdigest -d devdigest \
 *     -c "delete from pr_brief where pr_id = '<pr uuid>';"
 *
 * Env (all optional):
 *   DEMO_BASE_URL   web origin      default http://localhost:3000
 *   DEMO_API_URL    API origin      default http://localhost:3001
 *   DEMO_OUT        output dir      default ./recordings/l05-brief
 *   DEMO_REPO       repo full_name  default teplyakoff/dev-digest
 *   DEMO_PR         PR number       default 1
 *   DEMO_HEADED     "1" to watch    default headless
 *   DEMO_BUILD_TIMEOUT  ms per build    default 180000
 *
 * Usage:
 *   npm run record:brief
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const API = process.env.DEMO_API_URL ?? "http://localhost:3001";
const OUT = process.env.DEMO_OUT ?? join(HERE, "recordings", "l05-brief");
const REPO_NAME = process.env.DEMO_REPO ?? "teplyakoff/dev-digest";
const PR_NUMBER = Number(process.env.DEMO_PR ?? 1);
const HEADED = process.env.DEMO_HEADED === "1";
const BUILD_TIMEOUT = Number(process.env.DEMO_BUILD_TIMEOUT ?? 180_000);

const VIEWPORT = { width: 1280, height: 720 };
const CAPTION_ID = "__devdigest_caption";

interface Repo { id: string; full_name: string }
interface Pull { id: string; number: number; title: string; head_sha: string | null }
interface Risk { kind: string; title: string; explanation: string; severity: string; file_refs: string[] }
interface ReviewFocusItem { path: string; reason: string }
interface BriefRecord {
  pr_id: string;
  what: string;
  why: string;
  risk_level: string;
  risks: Risk[];
  review_focus: ReviewFocusItem[];
  risks_grounded: boolean;
  dropped_blocks: string[];
  unavailable_inputs: string[];
  head_sha: string;
  provider: string;
  model: string;
  derived_at: string;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  attempts: number;
}
interface BriefView {
  brief: BriefRecord | null;
  stale: boolean;
  reused: boolean;
  model_calls: number;
}
interface Blast {
  changed_files: string[];
  symbols: { name: string; file: string; callers: { file: string }[] }[];
  endpoints: { route: string; file: string }[];
  crons: { name: string; file: string }[];
  status: string;
  indexed_sha: string | null;
}

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
 * The claim this recording exists to make, checked rather than filmed.
 *
 * "Risks reference files from the blast map" is the lab's acceptance criterion,
 * and it is invisible on camera: a hallucinated path renders exactly like a real
 * one. So the allowlist is rebuilt here from the PR's own blast response — the
 * same source the server grounds against — and every cited path is looked up in
 * it.
 *
 * The focus list is checked against FILE paths only, never endpoint routes: a
 * focus item is a thing the reviewer clicks to open a file card, so a route that
 * survived grounding would be a link to nothing.
 */
function assertGrounded(brief: BriefRecord, blast: Blast): { files: number; refs: number; focus: number } {
  const files = new Set<string>(blast.changed_files);
  for (const s of blast.symbols) {
    files.add(s.file);
    for (const c of s.callers) files.add(c.file);
  }
  for (const e of blast.endpoints) files.add(e.file);
  for (const c of blast.crons) files.add(c.file);

  const routes = new Set(blast.endpoints.map((e) => e.route));

  if (files.size === 0) {
    throw new Error(
      "The blast map lists no files at all — grounding cannot be asserted against an empty allowlist. " +
        "Index the repo first (the Blast Radius tab shows its state).",
    );
  }

  let refs = 0;
  for (const risk of brief.risks) {
    if (risk.file_refs.length === 0) {
      throw new Error(`Risk "${risk.title}" cites nothing — AC-68 should have dropped it before it reached the card.`);
    }
    for (const ref of risk.file_refs) {
      refs++;
      if (!files.has(ref) && !routes.has(ref)) {
        throw new Error(`Risk "${risk.title}" cites ${ref}, which is in neither the blast map nor its endpoints.`);
      }
    }
  }

  for (const item of brief.review_focus) {
    if (/:\d+\s*$/.test(item.path)) {
      throw new Error(
        `Review focus carries a line number (${item.path}). The brief deliberately ships paths only — ` +
          "blast line numbers are computed against the indexed sha, not the PR head.",
      );
    }
    if (!files.has(item.path)) {
      throw new Error(`Review focus points at ${item.path}, which the blast map does not list.`);
    }
  }

  return { files: files.size, refs, focus: brief.review_focus.length };
}

/** Build the brief through the API and return the row, so the scenes can read it. */
async function buildBrief(prId: string): Promise<BriefView> {
  const started = Date.now();
  const view = await api<BriefView>(`/pulls/${prId}/brief`, { method: "POST" });
  log(`built in ${((Date.now() - started) / 1000).toFixed(1)}s — ${view.model_calls} model call(s)`);
  return view;
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const repos = await api<Repo[]>("/repos");
  const repo = repos.find((r) => r.full_name === REPO_NAME);
  if (!repo) throw new Error(`Repo ${REPO_NAME} is not imported — import it first.`);

  const pulls = await api<Pull[]>(`/repos/${repo.id}/pulls`);
  const pull = pulls.find((p) => p.number === PR_NUMBER);
  if (!pull) throw new Error(`PR #${PR_NUMBER} not found in ${REPO_NAME}.`);

  const blast = await api<Blast>(`/pulls/${pull.id}/blast`);
  if (blast.status === "degraded") {
    warn("blast is DEGRADED — the brief still builds, but grounding falls back to the PR's own file list.");
  }

  const before = await api<BriefView>(`/pulls/${pull.id}/brief`);
  const startsEmpty = before.brief === null;
  if (!startsEmpty) {
    warn(
      `PR #${pull.number} already has a brief (built ${before.brief?.derived_at}). ` +
        "Part 1 films the built card instead of the empty state — see the header for how to reset it.",
    );
  }

  let browser: Browser | undefined;
  let ctx: BrowserContext | undefined;
  try {
    browser = await chromium.launch({ headless: !HEADED });
    ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      recordVideo: { dir: OUT, size: VIEWPORT },
      colorScheme: "dark",
    });
    const page = await ctx.newPage();

    const prUrl = `${BASE}/repos/${repo.id}/pulls/${pull.number}`;

    // ---- Part 1: the empty card -------------------------------------------

    await page.goto(`${prUrl}?tab=overview`, { waitUntil: "networkidle" });
    await sleep(1400);
    await beat(page, 1, `${repo.full_name} #${pull.number} — Overview, before anything is built`, 3600);
    await shot(page, startsEmpty ? "brief-empty" : "brief-existing");

    // ---- Part 2: the build -------------------------------------------------

    let view: BriefView;
    if (startsEmpty) {
      await beat(page, 2, "Build brief — one structured call, capped at 8 000 input tokens", 2600);
      const done = page.waitForResponse(
        (r) => r.url().includes("/brief") && r.request().method() === "POST",
        { timeout: BUILD_TIMEOUT },
      );
      await page.getByRole("button", { name: /Build brief/i }).first().click();
      await done;
      await sleep(1800);
      view = await api<BriefView>(`/pulls/${pull.id}/brief`);
    } else {
      view = before;
      await beat(page, 2, "The brief for this commit is already built — its card is below", 2600);
    }

    const brief = view.brief;
    if (!brief) throw new Error("No brief on the PR after the build — nothing to film.");

    await page.getByText(brief.what.slice(0, 24), { exact: false }).first().waitFor({ timeout: 20_000 });
    await sleep(900);
    await beat(page, 3, `Risk level: ${brief.risk_level.toUpperCase()} — and why the change exists, in its own words`, 5200);
    await shot(page, "brief-card");

    // ---- Part 3: the grounding check ---------------------------------------

    const grounded = assertGrounded(brief, blast);
    log(
      `grounding ✓ ${grounded.refs} risk reference(s) and ${grounded.focus} focus path(s) ` +
        `all inside an allowlist of ${grounded.files} file(s)`,
    );

    const focusHeading = page.getByText("Review focus", { exact: false }).first();
    await focusHeading.scrollIntoViewIfNeeded();
    await sleep(700);
    await beat(page, 4, `Review focus — ${grounded.focus} file(s), every one of them real: checked against the blast map`, 5200);
    await shot(page, "brief-review-focus");

    // ---- Part 4: the link ---------------------------------------------------

    const target = brief.review_focus[0];
    if (!target) throw new Error("The brief has no review-focus item — there is no link to follow.");

    await beat(page, 5, `Following the first item: ${target.path}`, 2400);
    await page.getByRole("button", { name: new RegExp(`Open ${target.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).first().click();
    await page.waitForURL(/tab=diff/, { timeout: 20_000 });
    await sleep(2000);

    const url = new URL(page.url());
    if (url.searchParams.get("file") !== target.path) {
      throw new Error(`The URL carries file=${url.searchParams.get("file")}, not ${target.path}.`);
    }
    if (url.searchParams.get("view") !== "smart") {
      throw new Error(`The link left smart order: view=${url.searchParams.get("view")}.`);
    }
    log(`deep link ✓ ${url.pathname}${url.search}`);

    await beat(page, 6, "The changes tab, that file's card open and in frame — a path, never a line number", 5200);
    await shot(page, "diff-file-open");

    // ---- Part 5: the cache --------------------------------------------------

    // The claim no camera can make. A full re-open of the same PR state must
    // answer from the stored row: nothing on screen looks different, which is
    // precisely why the numbers are read from the API instead.
    const reopened = await api<BriefView>(`/pulls/${pull.id}/brief`);
    if (!reopened.reused) throw new Error("Re-opening the same PR state did not reuse the stored brief.");
    if (reopened.model_calls !== 0) {
      throw new Error(`Re-opening spent ${reopened.model_calls} model call(s); a cache read must spend none.`);
    }
    if (reopened.brief?.derived_at !== brief.derived_at) {
      throw new Error("`derived_at` moved on a plain read — the brief was rebuilt when it should have been served.");
    }
    log(`cache ✓ reused=true, model_calls=0, derived_at unmoved (${brief.derived_at})`);

    await page.goto(`${prUrl}?tab=overview`, { waitUntil: "networkidle" });
    await sleep(1600);
    await page.getByText("Cached", { exact: false }).first().scrollIntoViewIfNeeded().catch(() => {});
    await sleep(600);
    await beat(page, 7, "Re-opened: served from the stored row — reused, model_calls: 0, not one token spent", 5400);
    await shot(page, "brief-cached");

    // ---- Part 6: the rebuild ------------------------------------------------

    await beat(page, 8, "Rebuild forces a fresh build on an unchanged head — one more call, on purpose", 2800);
    const rebuilt = page.waitForResponse(
      (r) => r.url().includes("/brief") && r.request().method() === "POST",
      { timeout: BUILD_TIMEOUT },
    );
    await page.getByRole("button", { name: /Rebuild brief/i }).first().click();
    await rebuilt;
    await sleep(2200);

    const after = await api<BriefView>(`/pulls/${pull.id}/brief`);
    if (after.brief && after.brief.derived_at === brief.derived_at) {
      throw new Error("Rebuild left `derived_at` untouched — the button did not rebuild anything.");
    }
    log(`rebuild ✓ derived_at ${brief.derived_at} → ${after.brief?.derived_at}`);
    await beat(page, 9, "Rebuilt against the same commit — a new timestamp, and the cost of one call", 5000);
    await shot(page, "brief-rebuilt");

    const summary = {
      recorded_at: new Date().toISOString(),
      repo: repo.full_name,
      pr: pull.number,
      started_empty: startsEmpty,
      blast: { status: blast.status, indexed_sha: blast.indexed_sha, allowlist_files: grounded.files },
      brief: {
        risk_level: brief.risk_level,
        what: brief.what,
        why: brief.why,
        risks: brief.risks.map((r) => ({ severity: r.severity, title: r.title, file_refs: r.file_refs })),
        review_focus: brief.review_focus,
        risks_grounded: brief.risks_grounded,
        dropped_blocks: brief.dropped_blocks,
        unavailable_inputs: brief.unavailable_inputs,
        head_sha: brief.head_sha,
        model: `${brief.provider}/${brief.model}`,
        tokens_in: brief.tokens_in,
        tokens_out: brief.tokens_out,
        cost_usd: brief.cost_usd,
        attempts: brief.attempts,
        derived_at: brief.derived_at,
      },
      asserted: {
        grounded_refs: grounded.refs,
        grounded_focus: grounded.focus,
        focus_carries_no_line_numbers: true,
        deep_link: `${url.pathname}${url.search}`,
        cache_read_model_calls: reopened.model_calls,
        rebuild_moved_derived_at: after.brief?.derived_at ?? null,
      },
      build_model_calls: view.model_calls,
      rebuild_cost_usd: after.brief?.cost_usd ?? null,
    };
    writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));

    await page.close();
    await ctx.close();
    ctx = undefined;

    const raw = await page.video()?.path();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const final = join(OUT, `devdigest-brief-${stamp}.webm`);
    if (raw) renameSync(raw, final);
    const mp4 = raw ? toMp4(final) : null;

    log(`\x1b[32m✓ video:\x1b[0m ${mp4 ?? (raw ? final : "(not recorded)")}`);
    log(`\x1b[32m✓ frames + summary.json:\x1b[0m ${OUT}`);
  } finally {
    await ctx?.close();
    await browser?.close();
  }
}

main().catch((err) => {
  console.error(`\x1b[31m✗ ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
  process.exit(1);
});

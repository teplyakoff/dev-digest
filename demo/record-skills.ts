/**
 * DevDigest screencast recorder — L02 Skills.
 *
 * Drives the running dev stack through the whole Skills feature and writes a
 * video plus one PNG per step: the grid, the preview drawer, authoring and
 * versioning, the import preview's ignored-entries list, the agent Skills tab,
 * and the run trace where a skill shows up as its own prompt block with a token
 * count.
 *
 * Unlike `record.ts`, this one is **free**: it triggers no review, so no model
 * is ever called. Every scene runs against data that already exists or that the
 * recorder creates through the API. The single scene it cannot manufacture is
 * the trace — that needs a run someone already paid for — so it searches for one
 * and says so plainly if there is none, rather than recording an empty drawer.
 *
 * Re-runnable: the skills it creates are deleted by name up front, and the agent
 * link set it edits is restored at the end.
 *
 * Prereqs: the dev stack is up (`../scripts/dev.sh`) and `npm run setup` has
 * fetched the Chromium build.
 *
 * Env (all optional):
 *   DEMO_BASE_URL   web origin      default http://localhost:3000
 *   DEMO_API_URL    API origin      default http://localhost:3001
 *   DEMO_OUT        output dir      default ./recordings/l02-skills
 *   DEMO_HEADED     "1" to watch    default headless
 *
 * Usage:
 *   npm run record:skills
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixtureArchive, FIXTURE_IGNORED, FIXTURE_SKILL_NAME } from "./lib/skills-fixture";

const HERE = dirname(fileURLToPath(import.meta.url));

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const API = process.env.DEMO_API_URL ?? "http://localhost:3001";
const OUT = process.env.DEMO_OUT ?? join(HERE, "recordings", "l02-skills");
const HEADED = process.env.DEMO_HEADED === "1";

const VIEWPORT = { width: 1280, height: 720 };

/** The skill this recording authors from scratch. Deleted up front so a second
 *  run does not collide with the unique (workspace, name) index. */
const AUTHORED = {
  name: "migration-safety",
  description:
    "Flag a migration that drops or narrows a column without a backfill, and any edit to one already applied.",
  type: "convention",
  body: [
    "# Migration safety",
    "",
    "A schema migration runs once, against data you cannot see. Judge it as a",
    "one-way door.",
    "",
    "## Flag these",
    "- A column or table DROPped in the same migration that stops writing to it —",
    "  the old code is still running during the deploy.",
    "- A column made NOT NULL, or its type narrowed, without a backfill statement",
    "  in the same file.",
    "- A new NOT NULL column with no DEFAULT on a table that already has rows.",
    "- A UNIQUE index added without a statement that resolves existing duplicates.",
    "",
    "## Do not flag",
    "- Additive changes: a nullable column, a new table, a new index.",
    "",
    "## Reporting",
    "- CRITICAL for data loss or a migration that fails midway on real data.",
    "- Cite the exact `file:line` of the statement.",
  ].join("\n"),
};

/** Appended in the versioning scene, to make the save a BODY change — only a
 *  body change snapshots a version, which is the point of the scene. */
const AUTHORED_APPENDED_RULE = [
  "",
  "## Rollout",
  "- Name the expand / backfill / contract step this migration is, and say which",
  "  release the next step lands in.",
].join("\n");

// --- tiny helpers ------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

function log(msg: string) {
  process.stdout.write(`\x1b[36m▸\x1b[0m ${msg}\n`);
}

function warn(msg: string) {
  process.stdout.write(`\x1b[33m!\x1b[0m ${msg}\n`);
}

// --- caption overlay ---------------------------------------------------------
// No audio, so each step narrates itself. Re-injected per step because a
// client-side route change drops the node.

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

async function beat(page: Page, step: number, text: string, ms = 2800) {
  await caption(page, step, text);
  await sleep(ms);
}

/** See `record.ts` — Playwright records VP8/WebM only; a real ffmpeg on PATH
 *  turns it into an mp4 that plays in QuickTime and Keynote. */
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
    warn(res.error?.message.includes("ENOENT") ? "ffmpeg not on PATH — keeping the webm" : "ffmpeg failed — keeping the webm");
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

type Skill = { id: string; name: string; enabled: boolean; version: number };
type Agent = { id: string; name: string };
type AgentSkillLink = { agent_id: string; skill_id: string; order: number };
type Repo = { id: string; full_name: string };
type Pull = { id: string; number: number };
type RunSummary = { run_id: string; agent_name: string | null; status: string | null };
type Trace = { config?: { skills?: { name: string; version: number; tokens: number }[] | null } };

/** A run whose trace carries `config.skills` — the only scene the recorder
 *  cannot manufacture, because it needs a review someone already paid for. */
interface SkillRun {
  repoId: string;
  prNumber: number;
  runId: string;
  agentName: string;
  skills: { name: string; version: number; tokens: number }[];
}

async function findRunWithSkills(): Promise<SkillRun | null> {
  const repos = await api<Repo[]>("/repos");
  for (const repo of repos) {
    const pulls = await api<Pull[]>(`/repos/${repo.id}/pulls`).catch(() => []);
    for (const pull of pulls) {
      const runs = await api<RunSummary[]>(`/pulls/${pull.id}/runs`).catch(() => []);
      for (const run of runs) {
        if (run.status !== "done") continue;
        const trace = await api<Trace>(`/runs/${run.run_id}/trace`).catch(() => null);
        const skills = trace?.config?.skills;
        if (skills?.length) {
          return {
            repoId: repo.id,
            prNumber: pull.number,
            runId: run.run_id,
            agentName: run.agent_name ?? "agent",
            skills,
          };
        }
      }
    }
  }
  return null;
}

/** Delete by name so a re-run starts clean — `skills` has a unique
 *  (workspace_id, name) index, so a second create would 409. */
async function deleteSkillsByName(names: string[]) {
  const all = await api<Skill[]>("/skills");
  for (const s of all.filter((x) => names.includes(x.name))) {
    await api(`/skills/${s.id}`, { method: "DELETE" });
    log(`cleaned up existing skill "${s.name}"`);
  }
}

// --- the recording -----------------------------------------------------------

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) {
    if (f.startsWith("page@") && f.endsWith(".webm")) rmSync(join(OUT, f), { force: true });
  }

  await deleteSkillsByName([AUTHORED.name, FIXTURE_SKILL_NAME]);

  const agents = await api<Agent[]>("/agents");
  const agent = agents.find((a) => a.name === "Test Quality Reviewer") ?? agents[0];
  if (!agent) throw new Error("No agents — seed the database first (`pnpm db:seed`).");
  // Snapshot the link set so the recording leaves the workspace as it found it.
  const originalLinks = await api<AgentSkillLink[]>(`/agents/${agent.id}/skills`);

  const traceRun = await findRunWithSkills();
  if (traceRun) {
    log(`trace scene: ${traceRun.agentName} on PR #${traceRun.prNumber} — ${traceRun.skills.map((s) => `${s.name} v${s.version} (${s.tokens} tok)`).join(", ")}`);
  } else {
    warn("no run with config.skills found — skipping the trace scenes.");
    warn("run a review with an agent that has a skill linked, then record again.");
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

    // 1 — the grid ---------------------------------------------------------
    await page.goto(`${BASE}/skills`, { waitUntil: "networkidle" });
    await page.getByText("test-quality-rubric", { exact: true }).first().waitFor({ timeout: 15_000 });
    await beat(page, 1, "Skills — reusable review rules, shared by many agents", 3200);
    await shot(page, "skills-grid");

    // 2 — the preview drawer ------------------------------------------------
    await page.getByText("breaking-change", { exact: true }).first().click();
    await page.getByRole("button", { name: "Open editor" }).waitFor({ timeout: 10_000 });
    await beat(page, 2, "Click a card — the body, exactly as the agent receives it", 3600);
    await shot(page, "preview-drawer");
    await page.getByRole("button", { name: "Close" }).first().click();
    await sleep(600);

    // 3 — author one from scratch -------------------------------------------
    await beat(page, 3, "Add Skill → Create from scratch", 2000);
    await page.getByRole("button", { name: "Add Skill" }).click();
    await page.getByText("Create from scratch", { exact: true }).click();
    await page.getByPlaceholder("test-quality-rubric").fill(AUTHORED.name);
    await page.getByPlaceholder("Flag new branches that no test asserts on").fill(AUTHORED.description);
    await page.locator("select").first().selectOption(AUTHORED.type);
    await page.locator("textarea").first().fill(AUTHORED.body);
    await caption(page, 3, "The description is the skill's interface — write it as a directive");
    await sleep(2600);
    await shot(page, "create-modal");
    await page.getByRole("button", { name: "Create skill" }).click();
    await page.waitForURL("**/skills/**", { timeout: 15_000 });
    await page.getByText("Configuration", { exact: true }).waitFor({ timeout: 10_000 });
    await beat(page, 4, `"${AUTHORED.name}" created at v1 — live token count in the body header`, 3400);
    await shot(page, "editor-config-v1");

    // 5 — a body change snapshots a version ---------------------------------
    const bodyBox = page.locator("textarea").first();
    await bodyBox.fill(AUTHORED.body + AUTHORED_APPENDED_RULE);
    await page.getByText(/snapshots it as v2/i).waitFor({ timeout: 10_000 });
    await beat(page, 5, "Change the body — the hint names the version the save will produce", 3400);
    await shot(page, "editor-dirty-v2-hint");
    await page.getByRole("button", { name: "Save skill" }).click();
    await page.getByText("v2", { exact: true }).first().waitFor({ timeout: 10_000 });
    await beat(page, 6, "Saved — the header badge moves to v2", 2800);
    await shot(page, "editor-saved-v2");

    // 7 — versions -----------------------------------------------------------
    await page.getByRole("button", { name: "Versions" }).click();
    await page.getByText("Version history", { exact: false }).waitFor({ timeout: 10_000 });
    await beat(page, 7, "Every body change is snapshotted, so an eval stays reproducible", 3600);
    await shot(page, "editor-versions");

    // 8 — preview ------------------------------------------------------------
    await page.getByRole("button", { name: "Preview" }).click();
    await page.getByText("Rendered as the reviewing agent receives it", { exact: false }).waitFor({ timeout: 10_000 });
    await beat(page, 8, "Preview — the markdown the model actually reads", 3200);
    await shot(page, "editor-preview");

    // 9 — import: the ignored list ------------------------------------------
    await page.goto(`${BASE}/skills`, { waitUntil: "networkidle" });
    await beat(page, 9, "Add Skill → Import from file — someone else's rules", 2400);
    await page.getByRole("button", { name: "Add Skill" }).click();
    await page.getByText("Import from file", { exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: `${FIXTURE_SKILL_NAME}.zip`,
      mimeType: "application/zip",
      buffer: buildFixtureArchive(),
    });
    await page.getByText("Ignored", { exact: false }).waitFor({ timeout: 15_000 });
    // Assert the claim rather than trusting the frame: every executable entry in
    // the archive has to be named in the preview, or the scene is a lie.
    const modalText = (await page.locator("body").innerText()) ?? "";
    const missing = FIXTURE_IGNORED.filter((p) => !modalText.includes(p));
    if (missing.length) throw new Error(`Import preview did not list as ignored: ${missing.join(", ")}`);
    log(`import preview listed all ${FIXTURE_IGNORED.length} non-body entries as ignored`);
    await beat(page, 10, "Nothing executable is read — run.sh, package.json and install.js are listed, never opened", 5200);
    await shot(page, "import-ignored-list");

    // 11 — confirm: it lands disabled ---------------------------------------
    await page.getByRole("button", { name: "Import skill" }).click();
    await page.waitForURL("**/skills/**", { timeout: 15_000 });
    await page.getByText("Disabled", { exact: true }).first().waitFor({ timeout: 10_000 });
    await beat(page, 11, "An imported skill lands DISABLED and badged “needs vetting” until a person enables it", 4600);
    await shot(page, "import-landed-disabled");

    // 12 — the agent Skills tab ---------------------------------------------
    await page.goto(`${BASE}/agents/${agent.id}?tab=skills`, { waitUntil: "networkidle" });
    await page.getByText("Order matters", { exact: false }).waitFor({ timeout: 15_000 });
    await beat(page, 12, `${agent.name} — every workspace skill, ticked ones load in this order`, 4000);
    await shot(page, "agent-skills-tab");

    await page.getByRole("checkbox", { name: AUTHORED.name }).click();
    await sleep(1400);
    await beat(page, 13, "Tick to attach — one write replaces the whole ordered set", 3400);
    await shot(page, "agent-skills-attached");
    // The globally disabled import stays listed and linkable — hiding it would
    // make "why is my skill not in the prompt?" unanswerable from this screen.
    await caption(page, 13, "A globally disabled skill stays visible: “will not load”, but still attachable");
    await sleep(3200);

    // 14 — the trace ---------------------------------------------------------
    if (traceRun) {
      const tokens = traceRun.skills.reduce((n, s) => n + s.tokens, 0);
      const prUrl = `${BASE}/repos/${traceRun.repoId}/pulls/${traceRun.prNumber}`;
      await page.goto(`${prUrl}?tab=findings&trace=${traceRun.runId}`, { waitUntil: "networkidle" });
      await page.getByText("Skills loaded", { exact: false }).waitFor({ timeout: 20_000 });
      await beat(page, 14, `Run trace · ${traceRun.agentName} — Configuration names every skill it loaded, with its version`, 4200);
      await shot(page, "trace-skills-loaded");

      // The prompt-assembly section is collapsed by default; the skills block is
      // the one that carries the token cost.
      await page.getByText("Prompt assembly", { exact: true }).click();
      const skillsBlock = page.getByText(/^Skills \(dynamic\)/).first();
      await skillsBlock.waitFor({ timeout: 10_000 });
      await skillsBlock.click();
      await skillsBlock.scrollIntoViewIfNeeded();
      await sleep(1000);
      await beat(page, 15, `The skill is its own prompt block — ${tokens} tokens on every run that loads it`, 5000);
      await shot(page, "trace-skills-prompt-block");

      await page.getByText("log", { exact: true }).first().click();
      await page.getByText(/Loaded \d+ skill/).first().waitFor({ timeout: 10_000 });
      await sleep(800);
      await beat(page, 16, "And the run log says it out loud: loaded, and what it cost", 4000);
      await shot(page, "trace-run-log");
    }

    const summary = {
      recorded_at: new Date().toISOString(),
      authored_skill: AUTHORED.name,
      imported_skill: FIXTURE_SKILL_NAME,
      ignored_entries_asserted: FIXTURE_IGNORED,
      agent: agent.name,
      trace_run: traceRun
        ? { run_id: traceRun.runId, agent: traceRun.agentName, pr: traceRun.prNumber, skills: traceRun.skills }
        : null,
    };
    writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));

    await page.close();
    await ctx.close();
    ctx = undefined;

    const raw = await page.video()?.path();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const final = join(OUT, `devdigest-skills-${stamp}.webm`);
    if (raw) renameSync(raw, final);

    const mp4 = raw ? toMp4(final) : null;
    log(`\x1b[32m✓ video:\x1b[0m ${mp4 ?? (raw ? final : "(not recorded)")}`);
    log(`\x1b[32m✓ frames + summary.json:\x1b[0m ${OUT}`);
    if (!traceRun) process.exitCode = 1;
  } finally {
    await ctx?.close();
    await browser?.close();
    // Restore the agent's link set — the recording is evidence, not a migration.
    await api(`/agents/${agent.id}/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill_ids: originalLinks.sort((a, b) => a.order - b.order).map((l) => l.skill_id) }),
    }).catch(() => warn("could not restore the agent's skill links"));
  }
}

main().catch((err) => {
  console.error(`\x1b[31m✗ ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
  process.exit(1);
});

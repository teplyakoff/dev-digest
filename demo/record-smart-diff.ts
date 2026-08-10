/**
 * DevDigest screencast recorder — L03 homework: the Smart Diff.
 *
 * Eleven scenes, in one unedited take:
 *
 *   1.  Files changed in ORIGINAL order — findings EXIST on this PR and not one
 *       of them is on screen (structural: `DiffViewer` has no way to receive
 *       findings at all). Asserted, not eyeballed: zero `Open finding:` buttons.
 *   2.  Toggle to SMART order — the section label flips to
 *       "Smart Diff · grouped by role".
 *   3.  The summary strip: file count, +/−, findings, changed lines.
 *   4.  The large-PR banner.
 *   5.  Core logic on top, with its role swatch and description.
 *   6.  The lock-file inside a COLLAPSED Boilerplate group — present, body not
 *       rendered.
 *   7.  A large file's `large file` chip.
 *   8.  A CORE file's header showing its `N finding(s)` badge — the file carries
 *       findings, before anyone opens anything.
 *   9.  The severity rail in the gutter and the severity tag ON the finding's own
 *       line. Together with 8 this is what the whole feature is for.
 *   10. Click that tag → `?tab=findings&…&finding=<id>`: the Agent runs tab, the
 *       owning accordion open, that finding's card expanded.
 *   11. Browser Back → `?tab=diff&view=smart`, still in Smart order.
 *
 * 8 AND 9 ARE TWO FRAMES BY CHOICE, NOT BY NECESSITY. An earlier cut demanded
 * both in one still and shipped a frame containing neither — but the cause was
 * occlusion, not distance: `onScreen()` checked only `y >= 0`, so an element
 * parked under the page's ~350 px sticky header passed while being invisible.
 * With that fixed, scene 8 does in fact carry the badge and the line tag
 * together (and the summary strip, the banner and the group header besides).
 * The split survives because the two stills answer different questions — "this
 * FILE carries findings" in wide context, "this LINE is one" up close — not
 * because one frame was impossible. Do not re-derive the old reason from the
 * shape of the code.
 *
 * THIS RECORDER TRIGGERS NO REVIEW, AND SPENDS NOTHING. That is deliberate, and
 * it is the correction the first take needed: it spent ~10 of its 11 minutes
 * filming agents run, which is the L01 feature, not this one. Smart Diff is the
 * grouping, the risk order and the click-through — all of which are already true
 * of a PR that has been reviewed at some point in the past. So the target must
 * be a PR that ALREADY carries findings, and the preflight below insists on it.
 *
 * TWO SCENES OF THE PLAN'S LIST ARE NOT FILMABLE HERE, and are not faked — see
 * `NOT_FILMABLE`. A third thing the earlier take filmed, "badges appearing after
 * a review", is not attempted at all; `OUT_OF_SCOPE` says why in the same place.
 *
 * Prereqs: the dev stack is up (`../scripts/dev.sh`), `npm run setup` has
 * fetched Chromium, and DEMO_PR points at a GENUINELY IMPORTED PR whose files
 * carry real `patch` text AND which already has at least one finding anchored to
 * a line that patch renders. A seeded PR has `patch: null`, so no diff body
 * renders, no finding can anchor to a line, and the per-line rail — half of what
 * this feature is — has nothing to draw on. The preflight refuses to launch the
 * browser when any of that is missing.
 *
 * WHY #1: 92 changed files with all three groups populated (core 44, wiring 36,
 * boilerplate 12); `demo/package-lock.json` in Boilerplate for the lock-file
 * criterion; 7 885 changed lines so the large-PR banner fires; and 2 findings
 * already anchored to rendered lines — one on a core file, one on a wiring file
 * — which is what makes scenes 8-10 real rather than staged.
 *
 * A broken claim THROWS. Nothing here costs money, so a take is free to redo and
 * a loud failure is strictly better than a video with a caption that lies. (The
 * earlier version recorded post-money failures instead of throwing; with the
 * review gone, that trade no longer has anything to buy.)
 *
 * Env (all optional):
 *   DEMO_BASE_URL  web origin       default http://localhost:3000
 *   DEMO_API_URL   API origin       default http://localhost:3001
 *   DEMO_OUT       output dir       default ./recordings/l03-smart-diff
 *   DEMO_REPO      repo full_name   default teplyakoff/dev-digest
 *   DEMO_PR        PR number        default 1
 *   DEMO_HEADED    "1" to watch     default headless
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
const PR_NUMBER = Number(process.env.DEMO_PR ?? 1);
const HEADED = process.env.DEMO_HEADED === "1";

const VIEWPORT = { width: 1280, height: 720 };
const CAPTION_ID = "__devdigest_caption";
/** How much of the viewport bottom the caption bar covers. Anything below this
    line is *in the DOM* but behind the caption, which is not "on screen". */
const CAPTION_BAND = 64;

/** Lock-files, by the same rule the classifier uses (`smart-diff/constants.ts`). */
const LOCK_FILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|bun\.lockb)$|\.lock$/;

/** Hunk header, copied from `client/src/components/diff-viewer/constants.ts`. */
const HUNK_HEADER_RE = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Roles whose files start COLLAPSED — mirrors `SmartDiffViewer/constants.ts:21`.
    A finding inside one of these renders no line tag until someone opens the
    card, so it cannot carry scene 8. */
const COLLAPSED_ROLES = new Set(["boilerplate"]);

const ROLE_ORDER = ["core", "wiring", "boilerplate"] as const;

interface Repo { id: string; full_name: string }
interface Pull { id: string; number: number; title: string }
interface PrFile { path: string; additions: number | null; deletions: number | null; patch: string | null }
interface PrDetail { number: number; title: string; status: string; files_count: number; files: PrFile[] }
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
interface ReviewRecord { run_id: string | null; agent_name: string | null; findings: { id: string }[] }

/** A finding that is provably filmable: it lands on a line its file's patch
    renders, in a group that is open by default. */
interface AnchoredFinding {
  path: string;
  role: SmartDiffGroup["role"];
  finding: SmartDiffFinding;
  /** How many findings the file has — the number its header badge must show. */
  fileFindings: number;
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

/**
 * Not "cannot", but "will not" — and the difference matters enough to say it in
 * the same breath as the two above, so nobody reads its absence as an oversight.
 */
const OUT_OF_SCOPE = {
  scene: "badges and rails APPEARING after a review, with no reload",
  why:
    "Running a review is not the Smart Diff feature — it is L01's. Filming it here cost the " +
    "first take ~10 of its 11 minutes and real money, and taught a viewer nothing about " +
    "grouping, risk order or the click-through. This recorder therefore triggers no review at " +
    "all and films a PR whose findings already exist. The no-reload invalidation is S6's claim; " +
    "it belongs to a test, not to this camera.",
};

function announceNotFilmable() {
  for (const item of NOT_FILMABLE) {
    note(`NOT FILMED — ${item.plan_scene}`);
    console.log(`    why: ${item.why}`);
    console.log(`    instead: ${item.capture_instead}`);
  }
  note(`OUT OF SCOPE — ${OUT_OF_SCOPE.scene}`);
  console.log(`    why: ${OUT_OF_SCOPE.why}`);
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
 * Is this element actually VISIBLE to the viewer — not merely inside the
 * viewport's coordinate range?
 *
 * `box.y >= 0` is not the same question, and the difference shipped a broken
 * still. The PR page keeps its breadcrumb, title and tab bar in a sticky region
 * ~350 px tall, so a diff line scrolled under it reports a positive `y`, passes
 * an arithmetic check, and is completely hidden. The first take of scene 8 was
 * framed that way: the gate said badge and tag were both on screen, and the
 * frame showed lines 76-96 with neither.
 *
 * So ask the DOM instead of the geometry: hit-test the element's own centre and
 * require that what comes back is the element or something inside it. That
 * catches the sticky header, the caption band, and any overlay added later —
 * none of which arithmetic knows about. The caption band is still subtracted
 * explicitly, because it is injected into the page and would otherwise win the
 * hit-test on its own terms.
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

/**
 * The card wrapping a file's header — `span.filePath → div.fileHeader → div.fileCard`.
 *
 * NOT `getByText(path).first()`: every non-boilerplate file is expanded in smart
 * mode, so thousands of diff lines are in the DOM, and a workflow or a doc that
 * merely MENTIONS `demo/package-lock.json` puts that exact string on a code line
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
 * The NEW-side line numbers a patch actually renders, mirroring
 * `parsePatch` + `renderedLineNumbers`
 * (`client/src/components/diff-viewer/helpers.ts:12`, `findings.ts:53`).
 *
 * This is the only way to know, before the browser opens, whether a finding will
 * get a rail and a clickable tag: the payload's `finding_lines` is just the
 * distinct `line` values (`smart-diff/service.ts:218`) and says nothing about
 * whether any rendered row carries that number. Deletions are excluded because
 * the parser never gives them a new-side number.
 */
function renderedNewLines(patch: string | null | undefined): Set<number> {
  const out = new Set<number>();
  if (!patch) return out;
  let newNo = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = raw.match(HUNK_HEADER_RE);
      if (m) newNo = parseInt(m[2]!, 10);
    } else if (raw.startsWith("+")) {
      out.add(newNo++);
    } else if (raw.startsWith("-")) {
      /* no new-side number */
    } else {
      out.add(newNo++);
    }
  }
  return out;
}

/** The word the tag shows — `findings.ts:131 severityTagLabel`. */
function severityTagLabel(severity: string): string {
  return severity === "CRITICAL" ? "blocker" : severity.toLowerCase();
}

/** The badge/strip label — the ICU plural in `messages/en/shell.json:44`. */
function findingsLabel(count: number): string {
  return `${count} ${count === 1 ? "finding" : "findings"}`;
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
 * Everything that can make a scene unfilmable, checked BEFORE the browser opens.
 *
 * Nothing here costs money any more, so the argument for the preflight has
 * changed shape but not strength: discovering at scene 8 that this PR's only
 * finding is unanchored means a wasted take and a video whose last three scenes
 * are missing. A free probe ahead of the take is the cheap habit in this package
 * (`demo/INSIGHTS.md`, 2026-08-06).
 *
 * Note the INVERSION against the earlier version of this file: findings on the
 * target used to be a warning ("scene 1's claim gets weaker"). They are now a
 * hard requirement, because with no review to trigger, a PR with no findings can
 * film neither the tag, nor the rail, nor the click-through — and scene 1's
 * claim is only worth making when there are findings to be missing.
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
      `Scene 5 needs Core logic on top; the payload's first group is \`${first?.role ?? "(none)"}\`. ` +
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
        : `PR #${pull.number} changes no lock-file, so scene 6 has nothing to film — pick a PR that touches one.`,
    );
  }

  // Preferably not the lock-file itself: scenes 6 and 7 want different cards, and
  // a lock-file is large often enough that `.at(0)` could collapse them into one.
  const largeFiles = sd.groups.flatMap((g) => g.files.filter((f) => f.is_large).map((f) => ({ ...f, role: g.role })));
  const large = largeFiles.find((f) => f.path !== lockFile.path) ?? largeFiles.at(0) ?? null;
  if (!large) {
    throw new Error(`No file on PR #${pull.number} is flagged \`is_large\`, so scene 7 has no chip to film.`);
  }

  if (!sd.split_suggestion.too_big) {
    throw new Error(
      `split_suggestion.too_big is false (${sd.split_suggestion.total_lines} changed lines), so scene 4 has no ` +
        "large-PR banner to film. Pick a PR above the split threshold.",
    );
  }

  // The findings that can actually be filmed: on a rendered new-side line, in a
  // group that is open by default.
  const patches = new Map(detail.files.map((f) => [f.path, f.patch]));
  const anchored: AnchoredFinding[] = [];
  const unfilmable: string[] = [];
  for (const role of ROLE_ORDER) {
    const group = sd.groups.find((g) => g.role === role);
    if (!group) continue;
    for (const file of group.files) {
      if (file.findings.length === 0) continue;
      const rendered = renderedNewLines(patches.get(file.path));
      for (const finding of file.findings) {
        const entry = {
          path: file.path,
          role,
          finding,
          fileFindings: file.findings.length,
        };
        if (!rendered.has(finding.line)) {
          unfilmable.push(`${file.path}:${finding.line} (no rendered line ${finding.line})`);
        } else if (COLLAPSED_ROLES.has(role)) {
          unfilmable.push(`${file.path}:${finding.line} (${role} starts collapsed, so no tag renders)`);
        } else {
          anchored.push(entry);
        }
      }
    }
  }
  if (totals.findings === 0) {
    throw new Error(
      `PR #${pull.number} carries no findings, and this recorder triggers no review. Scenes 8-10 — the badge, ` +
        "the rail, the tag and the click-through — are the feature, so a PR with no findings cannot film it. " +
        "Point DEMO_PR at a PR that has already been reviewed.",
    );
  }
  if (anchored.length === 0) {
    throw new Error(
      `PR #${pull.number} has ${totals.findings} finding(s) but none of them is filmable: ` +
        `${unfilmable.join("; ")}. Scene 8 needs a finding on a line the patch renders, in an expanded group.`,
    );
  }
  if (unfilmable.length) {
    warn(`${unfilmable.length} finding(s) on this PR cannot be filmed: ${unfilmable.join("; ")}`);
  }
  // Core first — that is where a reviewer's eye is meant to go, and ROLE_ORDER
  // already put the list in that order.
  const hero = anchored.find((a) => a.role === "core") ?? anchored[0]!;
  if (hero.role !== "core") {
    warn(`No anchored finding on a CORE file; scene 8 will film the one on ${hero.path} (${hero.role}) instead.`);
  }

  return { detail, smartDiff: sd, totals, lockFile, large, anchored, hero };
}

async function main() {
  console.log("");
  log("This recording triggers NO review and spends NOTHING — it films a PR whose findings already exist.");
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
  const hero = pre.hero;
  const heroTagWord = severityTagLabel(hero.finding.severity);
  const heroBadge = findingsLabel(hero.fileFindings);

  log(`target: ${repo.full_name} #${pull.number} — ${pull.title}`);
  log(
    `${pre.totals.files} files · ${pre.totals.lines} changed lines · ${pre.totals.findings} finding(s) · ` +
      `groups: ${pre.smartDiff.groups.map((g) => `${g.role}(${g.files.length})`).join(" → ")}`,
  );
  log(`lock-file: ${pre.lockFile.path} (+${pre.lockFile.additions} −${pre.lockFile.deletions}) → boilerplate ✓`);
  log(`large file: ${pre.large.path} (+${pre.large.additions} −${pre.large.deletions}) in ${pre.large.role}`);
  log(
    `hero finding: ${hero.path}:${hero.finding.line} [${hero.role}] ${heroTagWord} — ${hero.finding.title} ` +
      `(badge should read "${heroBadge}")`,
  );

  let browser: Browser | undefined;
  let ctx: BrowserContext | undefined;
  const scenes: { n: number; name: string; note?: string }[] = [];
  const record = (n: number, name: string, sceneNote?: string) => {
    scenes.push({ n, name, ...(sceneNote ? { note: sceneNote } : {}) });
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
    /** Every `Open finding:` button on screen — the anchored line tags and the
        unanchored chips alike (`shell.json:46` gives both the same label). */
    const findingButtons = page.getByRole("button", { name: /^Open finding: / });

    // ---- Scene 1: original order, no findings anywhere on it ---------------

    await page.goto(`${prUrl}?tab=diff&view=original`, { waitUntil: "networkidle" });
    // 92 files with real patches is a lot of DOM; give React room to land it.
    await sleep(2500);
    await ensureVisible(page.getByText(`Files changed · ${pre.detail.files_count} files`, { exact: false }));
    // The claim, asserted rather than eyeballed — and it is a real claim on THIS
    // PR precisely because the findings exist: `DiffViewer` has no prop that can
    // receive them (`components/diff-viewer/findings.ts:9-12`), so original mode
    // shows none of the ones the very next scene will show.
    const strayTags = await findingButtons.count();
    if (strayTags > 0) {
      throw new Error(
        `Original order is showing ${strayTags} finding tag(s) — with ${pre.totals.findings} finding(s) on this PR, ` +
          "the criterion is that not one of them is reachable in that mode.",
      );
    }
    await beat(
      page,
      1,
      `Original order — the order the API returns. ${pre.detail.files_count} files, no roles, and none of this PR's ` +
        `${pre.totals.findings} findings on any line`,
      4600,
    );
    await shot(page, "original-order");
    record(1, "Files changed in original order", `asserted: 0 finding tags on screen while ${pre.totals.findings} exist`);

    // ---- Scene 2: toggle to smart order ------------------------------------

    await page.getByRole("button", { name: "Smart order", exact: true }).click();
    await page.getByText("Smart Diff · grouped by role", { exact: true }).waitFor({ timeout: 30_000 });
    await sleep(2000);
    await beat(page, 2, "One toggle — the same files, grouped by the role each one plays in the change", 4200);
    await shot(page, "smart-order");
    record(2, "Toggle to Smart order, section label flips");

    // ---- Scene 3: the summary strip ----------------------------------------

    // The strip is the parent of its "N changed lines" span, and reading the
    // findings count OUT of that parent is what keeps this from matching a file
    // header's own badge further down the page.
    const changedLines = await ensureVisible(page.getByText(/changed lines?$/).first());
    const strip = changedLines.locator("xpath=..");
    const stripFindings = strip.getByText(/^\d+ findings?$/).first();
    await stripFindings.waitFor({ timeout: 15_000 });
    const stripText = (await stripFindings.textContent())?.trim();
    if (stripText !== findingsLabel(pre.totals.findings)) {
      throw new Error(
        `The summary strip reads "${stripText}" where the payload has ${pre.totals.findings} finding(s) ` +
          `(expected "${findingsLabel(pre.totals.findings)}").`,
      );
    }
    await beat(
      page,
      3,
      `${pre.totals.files} files · ${pre.totals.lines} changed lines · ${stripText} — the whole PR in one line`,
      4600,
    );
    await shot(page, "summary-strip");
    record(3, "Summary strip: files, +/−, findings, changed lines", `strip reads "${stripText}"`);

    // ---- Scene 4: the large-PR banner --------------------------------------

    // Preflight already refused a PR under the threshold, so a missing banner
    // here is the client half of the criterion failing, not a soft landing.
    const banner = page.getByText(/This PR is large \(/).first();
    await ensureVisible(banner);
    await beat(
      page,
      4,
      `"This PR is large" — ${pre.smartDiff.split_suggestion.total_lines} changed lines, said before anyone starts reading`,
      4200,
    );
    await shot(page, "large-pr-banner");
    record(4, "Large-PR banner", `${pre.smartDiff.split_suggestion.total_lines} changed lines`);

    // ---- Scene 5: core logic on top ----------------------------------------

    // Framed on the DESCRIPTION, not the label: the group header holds swatch,
    // label, description and count in one div, and "Core logic" on its own is a
    // string a diff line in this very PR could contain verbatim (the label lives
    // in `messages/en/prReview.json`). The description is both more specific and
    // the thing this scene is supposed to show.
    const coreHeader = page
      .getByText("The substance of the change — review closely", { exact: true })
      .first()
      .locator("xpath=..");
    await frame(coreHeader, "start");
    await coreHeader.getByText("Core logic", { exact: true }).waitFor({ timeout: 15_000 });
    await beat(
      page,
      5,
      "Core logic first, with its swatch and what it means: the substance of the change — review closely",
      4600,
    );
    await shot(page, "core-on-top");
    record(5, "Core logic group on top, swatch + description");

    // ---- Scene 6: the lock-file in a collapsed Boilerplate group -----------

    const boilerplateHeader = page
      .getByText("Generated / mechanical — skim", { exact: true })
      .first()
      .locator("xpath=..");
    await frame(boilerplateHeader, "start");
    await boilerplateHeader.getByText("Boilerplate", { exact: true }).waitFor({ timeout: 15_000 });
    await beat(page, 6, "Boilerplate last — generated / mechanical, skim", 3400);
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
      "6b",
      `${pre.lockFile.path} — +${pre.lockFile.additions} −${pre.lockFile.deletions}, always Boilerplate, and closed until you ask`,
      5000,
    );
    await shot(page, "lockfile-collapsed");
    record(6, "Lock-file inside a collapsed Boilerplate group", "asserted: card has exactly one child, so no body");

    // ---- Scene 7: a large file's chip --------------------------------------

    const largeCard = await requireFileCard(page, pre.large.path);
    await frame(largeCard, "center");
    await largeCard.getByText("large file", { exact: true }).waitFor({ timeout: 15_000 });
    await beat(
      page,
      7,
      `${pre.large.path} — +${pre.large.additions} −${pre.large.deletions}: flagged \`large file\` before anyone opens it`,
      4800,
    );
    await shot(page, "large-file-chip");
    record(7, "A large file's `large file` chip");

    // ---- Scene 8: badge + rail + tag, in ONE frame -------------------------
    //
    // The frame the whole feature is for. All three are the same claim seen at
    // three zoom levels: the file carries findings (header badge), THIS line
    // does (the gutter rail), and it is this severity and clickable (the tag).

    const heroCard = await requireFileCard(page, hero.path);
    const heroBadgeBtn = heroCard.getByRole("button", { name: heroBadge, exact: true });
    // The anchored tag, not the unanchored chip: both carry `Open finding: …`
    // (`shell.json:46`), but a LINE tag's whole text is the severity word while
    // the chip below the diff reads `blocker · <title>`.
    const heroTag = heroCard
      .getByRole("button", { name: `Open finding: ${hero.finding.title}`, exact: true })
      .filter({ hasText: new RegExp(`^${heroTagWord}$`) })
      .first();
    await frame(heroCard, "start");
    await heroBadgeBtn.waitFor({ timeout: 15_000 });
    await heroTag.waitFor({ timeout: 15_000 });

    // The rail is a bare `<span>` with no text — `findingRailFor` in
    // `components/diff-viewer/styles.ts:117` gives it `position: absolute` and a
    // 3px width, and `CodeLine` renders it as the row's FIRST child, before the
    // gutter. So: from the tag, up to its row, and read that first child.
    const railOk = await heroTag.evaluate((el) => {
      const first = el.parentElement?.firstElementChild;
      if (!first || first.tagName.toLowerCase() !== "span") return false;
      const cs = getComputedStyle(first);
      return cs.position === "absolute" && cs.width === "3px";
    });
    if (!railOk) {
      throw new Error(
        `${hero.path}:${hero.finding.line} has a severity tag but no severity rail on its row — ` +
          "the gutter half of the criterion is missing.",
      );
    }

    // Two frames, and the reason is NOT that one was impossible — see the
    // header. Scene 8 lands wide (summary strip, banner, group header, file
    // header with its badge, and the tagged line all at once); scene 9 is the
    // close-up on the line itself. Each is gated by `onScreen()`, which
    // hit-tests rather than trusting coordinates, because the page's sticky
    // header silently swallowed an earlier take's stills.
    // "center", never "start": the PR page's breadcrumb/title/tab region is
    // sticky and ~350 px tall, so scrolling an element to the top of the
    // scroller parks it UNDER that region — present in the DOM, invisible in
    // the frame. Centring clears the sticky header and the caption band both.
    await frame(heroBadgeBtn, "center");
    if (!(await onScreen(heroBadgeBtn))) {
      throw new Error(`Could not frame ${hero.path}'s "${heroBadge}" badge.`);
    }
    await beat(page, 8, `${hero.path}: the header says "${heroBadge}" before you open anything`, 4200);
    await shot(page, "finding-badge-on-header");
    record(8, "The file header's findings badge", `${hero.role} · ${hero.path} · badge "${heroBadge}"`);

    await frame(heroTag, "center");
    if (!(await onScreen(heroTag))) {
      throw new Error(
        `Could not frame ${hero.path}'s line-${hero.finding.line} tag — it is occluded or off-screen.`,
      );
    }
    await beat(
      page,
      9,
      `line ${hero.finding.line}: the rail in the gutter and \`${heroTagWord}\` on the line itself`,
      5400,
    );
    await shot(page, "finding-rail-and-tag-on-line");
    record(
      9,
      "Severity rail and tag on the finding's own line",
      `${hero.path}:${hero.finding.line} · ${heroTagWord} · rail asserted`,
    );

    // ---- Scene 9: click the tag, land on the finding's card ----------------

    await beat(page, 10, "Click the tag on the line — the finding is one click from the code it is about", 3000);
    await heroTag.click();
    await page.waitForURL(/finding=/, { timeout: 30_000 });
    const url = page.url();
    const findingId = new URL(url).searchParams.get("finding");
    if (findingId !== hero.finding.id) {
      throw new Error(`Clicked ${hero.finding.id}'s tag and the URL carries \`finding=${findingId}\`: ${url}`);
    }
    if (!/tab=findings/.test(url)) throw new Error(`The click did not land on the Agent runs tab: ${url}`);

    const reviews = await api<ReviewRecord[]>(`/pulls/${pull.id}/reviews`);
    const owning = reviews.find((rv) => rv.findings.some((f) => f.id === findingId)) ?? null;

    const card = page.locator(`[data-finding-id="${findingId}"]`);
    await card.waitFor({ timeout: 30_000 });
    await sleep(1500);
    // Expanded, not merely present: the body — and with it the Accept action —
    // renders only when the card is open, which is what the deep link promises.
    // Presence alone would pass on a card the reader still has to click.
    if ((await card.getByRole("button", { name: /^Accept/ }).count()) === 0) {
      throw new Error("The finding's card is on screen but NOT expanded — `expandNonce` did not reach it.");
    }
    if (!owning?.run_id) {
      throw new Error(`No review run on this PR owns finding ${findingId} — the accordion claim cannot be checked.`);
    }
    const accordion = page.locator(`#review-run-${owning.run_id}`);
    if ((await accordion.locator(`[data-finding-id="${findingId}"]`).count()) === 0) {
      throw new Error(`The owning accordion (#review-run-${owning.run_id}) did not open around the card.`);
    }
    await frame(card, "center");
    await beat(
      page,
      9,
      `?tab=findings&finding=… — the Agent runs tab, ${owning.agent_name ?? "the owning run"}'s accordion open, that card expanded`,
      5400,
    );
    await shot(page, "finding-deep-link");
    record(10, "Finding click-through to its card", `owned by ${owning.agent_name ?? "?"} (run ${owning.run_id.slice(0, 8)})`);

    // ---- Scene 10: Back, still in Smart mode -------------------------------

    await beat(page, 11, "Back — and the Files tab is exactly where it was, still in Smart order", 3000);
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
    record(11, "Back returns to ?tab=diff&view=smart");

    const summary = {
      recorded_at: new Date().toISOString(),
      repo: repo.full_name,
      pr: pull.number,
      pr_id: pull.id,
      pr_title: pull.title,
      pr_status: pre.detail.status,
      /** No review is triggered by this recorder — see `out_of_scope`. */
      review_triggered: false,
      files: {
        count: pre.detail.files_count,
        with_patch: pre.detail.files.filter((f) => f.patch != null && f.patch.length > 0).length,
      },
      smart_diff: {
        groups: pre.smartDiff.groups.map((g) => ({ role: g.role, files: g.files.length })),
        findings: pre.totals.findings,
        changed_lines: pre.totals.lines,
        too_big: pre.smartDiff.split_suggestion.too_big,
        lock_file: { path: pre.lockFile.path, additions: pre.lockFile.additions, deletions: pre.lockFile.deletions },
        large_file: { path: pre.large.path, role: pre.large.role, additions: pre.large.additions, deletions: pre.large.deletions },
      },
      anchored_findings: pre.anchored.map((a) => ({
        path: a.path,
        role: a.role,
        line: a.finding.line,
        severity: a.finding.severity,
        id: a.finding.id,
      })),
      hero_finding: {
        id: hero.finding.id,
        path: hero.path,
        role: hero.role,
        line: hero.finding.line,
        severity: hero.finding.severity,
        tag: heroTagWord,
        badge: heroBadge,
        title: hero.finding.title,
      },
      finding_clicked: { id: findingId, url, run_id: owning.run_id, agent: owning.agent_name },
      original_mode_finding_tags: strayTags,
      scenes,
      not_filmable: NOT_FILMABLE,
      out_of_scope: OUT_OF_SCOPE,
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
    log(`\x1b[32m✓ ${scenes.length} scenes, no review triggered, nothing spent\x1b[0m`);
    console.log("");
    note("Still to capture as TEXT evidence — this recorder cannot film either:");
    announceNotFilmable();
  } finally {
    await ctx?.close();
    await browser?.close();
  }
}

main().catch((err) => {
  console.error(`\x1b[31m✗ ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
  process.exit(1);
});

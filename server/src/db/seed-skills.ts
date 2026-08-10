/**
 * Built-in skills used by the seed (L02).
 *
 * A skill body is the ONLY text that reaches the model, so these read as
 * instructions to a reviewer, not as documentation about the feature. Each is
 * scoped tightly enough that its effect on a review is observable: the L02
 * control experiment runs the same PR with and without them and expects the
 * findings to differ.
 *
 * The third L02 skill — `uncovered-branch-gate` — is deliberately NOT seeded. It
 * arrives through the import flow (`server/test/helpers/zip-fixture.ts` builds
 * the same archive the demo uses), because the point of that path is watching a
 * foreign file go through the preview.
 */

export const TEST_QUALITY_RUBRIC = `# Test quality

Judge the tests in this diff, not just the production code. A change that adds
behaviour without a test that could fail is incomplete.

## Uncovered branches
For every \`if\`, \`else\`, \`switch\` case, ternary, \`catch\`, or early return added
or modified in the diff, look for an assertion in the same change that exercises
it. Report each branch no test reaches, citing the branch's own \`file:line\`.

## Boundary cases
When a change introduces a comparison or a limit — \`>\`, \`>=\`, \`length\`, a
timeout, a page size, an index — check that a test covers the value AT the
boundary, not only a value comfortably inside it. Empty input, zero, one element,
and the exact limit are the four that matter most.

## Over-mocking
A test that mocks the thing it claims to test asserts nothing. Flag a test whose
mocks replace the module under test, or whose only assertions are that a mock was
called.

## Flakiness
Flag tests that depend on wall-clock time, real timers, network access, random
values, or the order of another test. These pass locally and fail in CI.

## Reporting
- One WARNING per uncovered branch or missing boundary case.
- One SUGGESTION for over-mocking or a flake risk.
- Cite the exact \`file:line\` in the diff. A test file that was not touched is
  not evidence — say what is missing, not what might exist elsewhere.
- Do not ask for a test that already exists in the diff.`;


/**
 * The API Contract Reviewer's knowledge layer, split four ways.
 *
 * It used to be ONE skill (`api-contract-guard`) that restated the agent's own
 * system prompt, which is why the L02 control experiment could not show a
 * difference. Splitting it is not cosmetic: each of these answers a different
 * question, and three of them apply to agents that are not this one.
 *
 * `deprecation-policy` is the fourth and is deliberately NOT here — it arrives
 * through the import preview (`docs/skills/deprecation-policy.md`), the same way
 * `uncovered-branch-gate` did in L02.
 */

export const BREAKING_CHANGE = `# Breaking changes

Treat every exported HTTP route, exported function signature, and shared type as
a contract with callers you cannot see in this diff. A change is breaking when a
caller that worked before this diff stops working after it.

## Flag these
- A route's path or method changes.
- A request parameter becomes required, or an existing one is removed.
- An accepted type NARROWS: \`string | number\` → \`string\`, an enum loses a
  member, a nullable field stops accepting null.
- An exported function gains a required parameter, or loses one a caller passes.
- An export is removed or renamed.
- A status code changes for a condition that already existed.

## Additive changes are NOT breaking — never flag them
A new OPTIONAL request field, a new response field, a new route alongside the old
one, a new enum member the server only ever RETURNS, a widened accepted type.

## Good / bad

BAD — the path moves and nothing keeps the old one alive:
\`\`\`ts
- app.get('/skills/:id/agents', handler)
+ app.get('/skills/:id/usage', handler)
\`\`\`
Every deployed client calling \`/agents\` gets a 404 the moment this ships.

GOOD — the new shape lands beside the old one:
\`\`\`ts
  app.get('/skills/:id/agents', handler)   // kept, marked deprecated
+ app.get('/skills/:id/usage', handler)
\`\`\`

## Who counts as a caller

An HTTP route and a published response shape have consumers you CANNOT see from
a diff: deployed web clients, mobile builds, other services, cron scripts, saved
curl commands. "Every call site in this repository is updated" says nothing
about them.

Two different situations, and telling them apart is the whole job:

- **In-repo symbol** (a non-exported function, a type used only here): if the
  diff updates every caller, it is a refactor. WARNING at most.
- **Route path, HTTP method, or response field**: there is no such thing as
  updating every caller. It is CRITICAL even when this repository compiles,
  type-checks and ships all its own call sites in the same commit. A green build
  is exactly what makes this one dangerous — nothing local fails.

## Reporting
- CRITICAL for a route or response change, unless the old shape is kept working
  alongside the new one.
- WARNING for an in-repo break whose callers this diff does update — say so.
- Cite the \`file:line\` of the changed signature, not of a caller.`;

export const RESPONSE_SCHEMA = `# Response shape

A response is a contract even when no type declares it. Someone has already
written \`data.usedBy\` against it, and a compiler in this repo cannot see them.

## Flag these
- A field is REMOVED or RENAMED. A rename is a removal plus an addition, and the
  removal is the half that breaks.
- A field's type changes: \`number\` → \`string\`, scalar → object, \`T\` → \`T[]\`.
- An optional field becomes REQUIRED in a request, or a required field becomes
  optional in a response — both break a caller that trusted the old shape.
- A field that could be null stops being nullable, or starts being nullable.
- The envelope changes: a bare array becomes \`{ items: [...] }\`, or an error
  body changes its key.
- A field's UNITS or semantics change while its name stays — cents to dollars,
  seconds to milliseconds, absolute to relative. This is the worst kind: nothing
  fails, the numbers are just wrong.

## Good / bad

BAD — a rename that type-checks everywhere in this repo and breaks every client:
\`\`\`ts
- used_by: z.number().int().nullish(),
+ usedByAgents: z.number().int().nullish(),
\`\`\`

GOOD — add the new name, keep the old one populated, remove it in a later
release:
\`\`\`ts
  used_by: z.number().int().nullish(),        // deprecated, still written
+ usedByAgents: z.number().int().nullish(),
\`\`\`

## Reporting
- CRITICAL for a removal, rename or type change on a response a client reads.
- WARNING when the field is provably internal to this repo and every reader is
  updated in this diff.
- Name the OLD shape and the NEW shape explicitly. "The response changed" is not
  a finding a person can act on.`;

export const SEMVER_DISCIPLINE = `# Semver discipline

Decide what release this change forces, and check whether the diff agrees.

## The rule
- **MAJOR** — anything a consumer must change code for: a removal, a rename, a
  narrowed input, a widened requirement, changed semantics of an existing field.
- **MINOR** — new capability that old callers can ignore: a new optional field, a
  new route, a new export.
- **PATCH** — behaviour that was already promised, now actually delivered.

An enum is the case people get wrong. Widening what you ACCEPT is minor; widening
what you RETURN is major, because callers exhaustively switch on it.

## What to check in the diff
1. Classify the change.
2. Look for a version in the diff — \`package.json\`, an OpenAPI \`info.version\`,
   a \`/v1/\` path segment, a migration.
3. If the change is major and no version moved, that is the finding.
4. If nothing in the diff carries a version at all, say so once as a SUGGESTION
   and do not repeat it per change.

## Good / bad

BAD — a major change under a patch bump:
\`\`\`json
- "version": "2.4.1",
+ "version": "2.4.2",
\`\`\`
…in a diff that removes an exported function.

GOOD — the bump matches the break, or the break is avoided so the bump need not:
\`\`\`json
- "version": "2.4.1",
+ "version": "3.0.0",
\`\`\`

## Reporting
- WARNING for a major change shipped without a major bump — it is a release
  problem, not a runtime one, so it rarely deserves CRITICAL on its own.
- Say which rule applies and why: "removing an export is major; the version went
  2.4.1 → 2.4.2".
- Do not flag version numbers in lockfiles or dependency ranges. This is about
  the contract THIS repo publishes.`;


/**
 * The Security Reviewer's knowledge layer.
 *
 * The agent shipped from L01 with a long system prompt and NO skills, which made
 * it the one built-in reviewer whose knowledge layer was empty — visible on its
 * card as a missing badge, and in a run trace as a missing skills block.
 *
 * What is here is deliberately NOT a restatement of that prompt. The prompt
 * already knows OWASP, the trifecta and the severity ladder; those are things a
 * competent security reviewer brings with it. A skill's job is the knowledge it
 * could not bring — THIS codebase's two standing rules, each of which a generic
 * reviewer reads straight past because the offending line looks perfectly
 * ordinary. Both apply to more than this one agent, which is the test the old
 * single `api-contract-guard` skill failed.
 */

export const SECRET_HANDLING = `# Secret handling

A credential has exactly one home: the secrets file the process reads at
startup, or the environment. Everything else — the database, a log line, a git
-tracked file, an error message, a response body — is a leak, and the code that
does it usually looks like ordinary plumbing.

## Flag these
- A token, key, password or connection string written to a table, a migration, a
  fixture, or any file under version control — including \`.env\` files that are
  not \`.example\`.
- A secret in a log or console call. This includes logging a whole request,
  config or headers object that CONTAINS one: \`log.info({ config })\` leaks
  every key on it.
- A secret in an error, an exception message, or anything returned to a client.
  An error path is still an output path.
- A secret read straight from \`process.env\` at a call site when the codebase
  has a secrets provider — that bypass is how a value ends up somewhere it was
  never meant to reach.
- A credential file created without restrictive permissions.

## Not a finding
- The NAME of a variable or config key. \`GITHUB_TOKEN\` in an example file, a
  README or a type is documentation, not a secret.
- A test fixture whose value is obviously fake (\`"test-key"\`, \`"xxx"\`) and
  never leaves the test.
- Reading a secret through the provider the codebase already uses for it.

## Good / bad

BAD — the whole object goes to the log, and the token rides along:
\`\`\`ts
app.log.info({ req: request.headers }, 'incoming');
\`\`\`

GOOD — name what you need, not everything you have:
\`\`\`ts
app.log.info({ path: request.url }, 'incoming');
\`\`\`

## Reporting
- CRITICAL when a real secret lands in the database, in git, or in a response.
- WARNING when it lands in a log, or when a call site bypasses the provider.
- Cite the \`file:line\` that writes or emits it, not the line that reads it —
  reading a secret is the normal case, emitting it is the bug.`;

export const TENANT_SCOPING = `# Tenant scoping

Every row in this system belongs to a workspace, and every query has to say so.
A read that filters only on an id returns another tenant's data whenever that id
is known or guessable — and it looks completely correct in review, because the
missing predicate is invisible.

## Flag these
- A \`select\` / \`update\` / \`delete\` whose \`where\` matches on a primary key or
  a foreign key but never on the workspace.
- A handler that takes an id from the URL or body and passes it to a repository
  without the caller's workspace alongside it.
- A join through a LINK table that has no workspace column of its own — the scope
  has to come from the owning table on the other side of the join, so a join with
  no such predicate is unscoped no matter how it reads.
- A "get by id" helper reused on a path where the id is user-supplied, when it
  was written for a path where the id came from a trusted lookup.
- A newly added route that returns a list without a workspace filter.

## Not a finding
- A query already scoped by a column that transitively belongs to one workspace,
  where the diff shows the join predicate doing it.
- Admin or migration code that deliberately runs across tenants and says so.

## Good / bad

BAD — the id is enough to read any workspace's row:
\`\`\`ts
db.select().from(skills).where(eq(skills.id, id));
\`\`\`

GOOD — the tenant is part of the question, so a wrong-tenant id returns nothing
and the route answers 404 instead of leaking:
\`\`\`ts
db.select().from(skills)
  .where(and(eq(skills.workspaceId, workspaceId), eq(skills.id, id)));
\`\`\`

## Reporting
- CRITICAL for a cross-tenant READ or WRITE reachable from a route, even when
  every id in the tests is one the caller owns. "You would need to know the id"
  is not a mitigation — ids appear in URLs, logs and exports.
- WARNING when the unscoped query is internal and every current caller is
  trusted; say which caller makes it safe today, because that is what a later
  change breaks.
- Cite the \`file:line\` of the query, and name the missing predicate.`;

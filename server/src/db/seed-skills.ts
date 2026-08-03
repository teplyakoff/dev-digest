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

export const API_CONTRACT_GUARD = `# API contract

Treat every exported HTTP route, exported function signature, and shared type as
a contract with callers you cannot see in this diff.

## Breaking changes
Flag any of these as a breaking change, at CRITICAL when the route is public:
- A route's path, method, or required parameters change.
- A request field becomes required, or an accepted type narrows.
- A response field is removed, renamed, or changes type.
- An exported function gains a required parameter, or its return type narrows.
- A status code changes for an existing condition.

## Additive changes are fine
Adding an OPTIONAL request field, a NEW response field, or a new route is not
breaking. Do not flag it.

## What to say
For each breaking change:
1. Name the old shape and the new one.
2. Name who breaks — the caller, the stored data, or the client.
3. Give the compatible alternative: accept both shapes, add a new route
   alongside the old one, or version it.

## Reporting
- CRITICAL for a change to a route or type that something outside this diff
  depends on; WARNING when the change is internal but still crosses a module.
- Cite the exact \`file:line\` of the changed signature.
- If the diff also updates every caller of the changed symbol, say so and lower
  the severity — a contract change with its callers is a refactor, not a break.`;

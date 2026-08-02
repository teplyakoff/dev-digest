# e2e docs

Long-form documentation for `@devdigest/e2e` — the material that is too detailed
for `CLAUDE.md` (which is a map, not a reference).

- `specs/` — specifications for work on this package (see `specs/README.md`).

Note the two meanings of "spec" here: `../specs/` holds the **browser flows** the
runner executes, while `specs/` (inside this folder) holds project-context
specifications, matching every other package. They are not interchangeable.

Package-level orientation stays in `../README.md`; cross-package material stays
in the repo root (`../../README.md`, `../../TESTING.md`, `../../docs/`).

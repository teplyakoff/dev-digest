# Importable skills

Skill bodies meant to be uploaded into DevDigest through **Skills → Add Skill →
Import**, rather than seeded.

These are NOT Claude Code skills — those live in `.claude/skills/` and are read by
the harness. A file here is a DevDigest skill: markdown that becomes the body of a
row in the `skills` table and, once linked to an agent, a block in that agent's
review prompt.

## Why any skill arrives this way

The import path exists to be a trust gate, and a gate nobody walks through is not
tested. Every DevDigest release should have at least one skill that got in by
being uploaded, previewed and adopted, rather than by being seeded.

Import writes nothing until a person has read the preview, and the skill lands
**disabled** — the body is someone else's instructions until it is turned on, and
that enable is the moment of adoption.

| File | Skill | Used by |
|---|---|---|
| `deprecation-policy.md` | `deprecation-policy` | API Contract Reviewer |

## What the preview will tell you about this file

`deprecation-policy.md` carries frontmatter keys the importer does not honour —
`allowed-tools`, `hooks`, `model`. They are there on purpose. The preview lists
them as **dropped**, which is the visible proof that a skill file cannot bring
executable behaviour with it: `hooks.post-review` names a script that is never
read, let alone run.

Only `name`, `description` and `type` are used. Everything else is text.

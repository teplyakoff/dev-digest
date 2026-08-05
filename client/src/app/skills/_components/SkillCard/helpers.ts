import type { Skill } from "@devdigest/shared";
import { UNTRUSTED_SOURCES } from "./constants";

/**
 * A skill that came from someone else and has not been turned on yet.
 *
 * Both halves matter: the badge is a prompt to READ the body before enabling it,
 * so it disappears the moment a person enables the skill — at that point they
 * have adopted the text and it is theirs.
 */
export function needsVetting(skill: Pick<Skill, "source" | "enabled">): boolean {
  return !skill.enabled && UNTRUSTED_SOURCES.includes(skill.source);
}

/** Case-insensitive match over the fields a person actually scans. */
export function filterSkills(skills: Skill[], query: string): Skill[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.type.toLowerCase().includes(q),
  );
}

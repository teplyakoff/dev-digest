import type { AgentSkillLink, Skill } from "@devdigest/shared";

/** A workspace skill plus whether this agent links it. */
export interface SkillRow {
  skill: Skill;
  linked: boolean;
}

/**
 * Linked skills first, in `order`; unlinked ones after, by name.
 *
 * Order is the point of this screen — it is the order the blocks appear in the
 * assembled prompt — so the linked set has to read top-to-bottom exactly as the
 * prompt will. Unlinked skills are a menu, and a menu sorts alphabetically.
 */
export function orderRows(skills: Skill[], links: AgentSkillLink[]): SkillRow[] {
  const orderById = new Map(links.map((l) => [l.skill_id, l.order]));
  const linked = skills
    .filter((s) => orderById.has(s.id))
    .sort((a, b) => (orderById.get(a.id) ?? 0) - (orderById.get(b.id) ?? 0))
    .map((skill) => ({ skill, linked: true }));
  const unlinked = skills
    .filter((s) => !orderById.has(s.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((skill) => ({ skill, linked: false }));
  return [...linked, ...unlinked];
}

/** The ordered ids to POST after toggling one skill's membership. */
export function toggleLink(currentIds: string[], skillId: string): string[] {
  return currentIds.includes(skillId)
    ? currentIds.filter((id) => id !== skillId)
    : [...currentIds, skillId];
}

/** Move `from` to `to` within the linked ids (drag-reorder). */
export function moveId(ids: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** Case-insensitive filter over name and type. */
export function filterRows(rows: SkillRow[], query: string): SkillRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) => r.skill.name.toLowerCase().includes(q) || r.skill.type.toLowerCase().includes(q),
  );
}

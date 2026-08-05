import type { IconName } from "@devdigest/ui";
import type { SkillSource, SkillType } from "@devdigest/shared";

/** Type accent colours — ported from the design's SKILL_TYPE. */
export const TYPE_COLOR: Record<SkillType, string> = {
  rubric: "#3b82f6",
  convention: "#10b981",
  security: "#ef4444",
  custom: "#999999",
};

/** Source chips. `imported_file` is L02's upload path (design had no icon for
 *  it; Upload is the same glyph the "Import from file" menu item uses). */
export const SOURCE_ICON: Record<SkillSource, IconName> = {
  manual: "Edit",
  extracted: "Wrench",
  community: "Globe",
  imported_url: "Link",
  imported_file: "Upload",
};

/**
 * Sources whose text someone else wrote. An unvetted skill from one of these
 * gets the "needs vetting" badge — the point being that enabling it is you
 * adopting a stranger's instructions into your agent's prompt.
 */
export const UNTRUSTED_SOURCES: readonly SkillSource[] = [
  "imported_file",
  "imported_url",
  "community",
];

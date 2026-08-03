import type { SkillType } from "@devdigest/shared";

/** Constants for CreateSkillModal. */

export const MODAL_WIDTH = 760;

/** Mirrors the `SkillType` enum — kept as a literal tuple so a new member is a
 *  type error here rather than a silently missing option. */
export const TYPE_OPTIONS: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

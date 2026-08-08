import type { SmartDiffRole } from "@devdigest/shared";

/**
 * Roles whose files start COLLAPSED — **even when they carry findings**.
 *
 * This is the client half of the acceptance criterion "a lock-file is always
 * Boilerplate and starts collapsed", and it is the half nothing on the server
 * can express: the `SmartDiff` contract has no `collapsed` field and the service
 * returns no open/closed state.
 *
 * Two rules pull the other way and both must lose here:
 *   - `FileCard`'s own `AUTO_EXPAND_MAX_LINES` rule opens any small file, and a
 *     one-line lock-file bump is small;
 *   - the design's `useState(file.finding_lines.length > 0)` opens any file with
 *     a finding.
 * Boilerplate is "generated / mechanical — skim". A reviewer who wants it opens
 * it; a reviewer who does not should never have to scroll past it. So the role
 * policy wins, which is why `SmartFileView.defaultOpen` is a required field
 * rather than a hint.
 */
export const COLLAPSED_ROLES: readonly SmartDiffRole[] = ["boilerplate"];

/* There is deliberately NO `ROLE_ORDER` here. Group order is the server's:
   `smart-diff/service.ts` emits groups in `ROLE_ORDER` and omits the empty ones,
   and `smart-diff-service.test.ts` pins core → wiring → boilerplate. A copy of
   that list on this side would be a second source of truth for the feature's
   central promise, drifting silently because neither side would fail.

   The maps below survive that deletion because they are keyed BY role and carry
   no order: which colour a role gets, and which roles start collapsed, are
   decisions the payload does not — and should not — express. */

/** Group swatch colour per role (design bundle, `diff.jsx` ROLE map). */
export const ROLE_COLOR: Record<SmartDiffRole, string> = {
  core: "var(--accent)",
  wiring: "var(--warn)",
  boilerplate: "var(--text-muted)",
};

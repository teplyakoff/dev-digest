/* SmartDiffViewer — the Files tab in SMART order: files grouped by the role the
   server classified them into (core → wiring → boilerplate), each group with its
   own collapse policy, each file rendered by the shared FileCard.

   It owns grouping, ordering, collapse policy and the summary strip. It does NOT
   own diff-line rendering: that stays in `FileCard`/`CodeLine`, reached through
   the one optional `smart` capability, so smart mode cannot drift away from what
   original mode shows. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile, SmartDiff } from "@devdigest/shared";
// Direct module import, not the folder barrel: frontend-architecture §12, and a
// barrel here would pull every diff-viewer module in to resolve one component.
import { FileCard } from "@/components/diff-viewer/FileCard/FileCard";
import { COLLAPSED_ROLES, ROLE_COLOR } from "./constants";
import { patchIndex, toPrFile, totalsFor } from "./helpers";
import { s, swatchFor } from "./styles";

interface SmartDiffViewerProps {
  /** The already-fetched response. This component NEVER fetches: `DiffTab` owns
      `useSmartDiff`, which is what lets a test render it from a plain fixture. */
  data: SmartDiff;
  /** The PR's files, for their patch text — `SmartDiff` carries none. */
  files: PrFile[];
  /**
   * The file the reviewer arrived to read, from `?file=<path>` — a review-focus
   * click on the Overview brief. It expands THAT card and nothing else; a path
   * that is not in this PR selects nothing, which is a legitimate landing state
   * rather than an error (AC-44).
   *
   * A PATH, never a `file:line`: the brief carries no line numbers, on purpose
   * (client/INSIGHTS.md, 2026-08-13), and this feature adds no line anchors to
   * `CodeLine` either.
   */
  selectedPath?: string | null;
  /** Navigates to this finding's card in the Agent runs tab (URL-driven). */
  onOpenFinding: (id: string) => void;
}

export function SmartDiffViewer({
  data,
  files,
  selectedPath,
  onOpenFinding,
}: SmartDiffViewerProps) {
  const t = useTranslations("prReview");
  const patches = React.useMemo(() => patchIndex(files), [files]);

  // Everything below is computed during render from `data`. No state, no effect:
  // totals and badge counts are derived values, and storing them would be the
  // "derive, don't store" anti-pattern with a stale-number failure mode.
  const totals = totalsFor(data);
  const split = data.split_suggestion;

  // The ONE effect in this component, and it owns no state the render needs:
  // `defaultOpen` above already expands the selected card, but a card thirty
  // files down opens off-screen, so the reviewer who clicked a review-focus
  // item sees nothing move. Bringing it into view is the other half of AC-42 —
  // the half no criterion spells out and every reader expects.
  const rootRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!selectedPath) return;
    const root = rootRef.current;
    if (!root) return;

    // NO SELECTOR INTERPOLATION. `selectedPath` is model-produced text that
    // survived server grounding — grounding proves the file exists, never that
    // the string is safe to build a CSS selector out of. `FindingsPanel` does
    // interpolate its `?finding=` value and gets away with it because that
    // value is a uuid; this one is a path. Reading the attribute back and
    // comparing strings costs one pass over a handful of nodes.
    const bring = () => {
      const card = Array.from(root.querySelectorAll("[data-file-path]")).find(
        (node) => node.getAttribute("data-file-path") === selectedPath,
      );
      // A path this PR does not carry scrolls nowhere — a legitimate landing
      // state, not an error (AC-44).
      //
      // `block: "start"` with the DEFAULT (instant) behaviour, and `s.fileCard`
      // carries the `scroll-margin-top` that clears the sticky PR header.
      // Smooth would fight the repeat below: each new call would restart an
      // animation the next mutation interrupts.
      card?.scrollIntoView?.({ block: "start" });
    };

    bring();

    // THE LIST GROWS AFTER THIS EFFECT, and that is the whole reason for the
    // observer. On a 92-file PR the cards mount before their diff bodies do, so
    // the target sits ~13 px down when the first scroll lands and ~22 000 px
    // down once the cards above it have rendered their lines. A single scroll
    // is therefore correct at the moment it runs and wrong a beat later — which
    // is exactly the shape that made this look fine when clicked from Overview
    // (already laid out) and do nothing on a freshly opened shared link.
    const observer = new MutationObserver(bring);
    observer.observe(root, { childList: true, subtree: true });
    // Stop chasing once the list has settled: past this point a scroll would be
    // yanking a reader who has started scrolling for themselves.
    const stop = setTimeout(() => observer.disconnect(), 2000);
    return () => {
      observer.disconnect();
      clearTimeout(stop);
    };
  }, [selectedPath, data]);

  return (
    <div ref={rootRef}>
      <div style={s.summaryStrip}>
        <span>{t("smartDiff.filesCount", { count: totals.files })}</span>
        <span className="mono tnum" style={s.stat}>
          <span style={s.addText}>+{totals.additions}</span>{" "}
          <span style={s.delText}>−{totals.deletions}</span>
        </span>
        <span style={s.sep}>·</span>
        <span>{t("smartDiff.findingsBadge", { count: totals.findings })}</span>
        <span style={s.sep}>·</span>
        <span>{t("smartDiff.summary", { count: totals.lines })}</span>
      </div>

      {split.too_big && (
        <div style={s.banner}>
          <Icon.AlertTriangle size={18} style={s.bannerIcon} />
          <div>
            <div style={s.bannerTitle}>
              {t("smartDiff.largeTitle", { lines: split.total_lines })}
            </div>
            {/* `largeBody` ends in a colon introducing the proposed splits, so it
                renders only when there are any. Generating them needs a model
                call the zero-token constraint forbids, so today it never does. */}
            {split.proposed_splits.length > 0 && (
              <div style={s.bannerBody}>{t("smartDiff.largeBody")}</div>
            )}
          </div>
        </div>
      )}

      {/* Rendered in PAYLOAD ORDER, not re-sorted here. The service emits groups
          in `ROLE_ORDER` and omits empty ones, so core → wiring → boilerplate is
          the server's guarantee and is pinned there by
          `server/test/smart-diff-service.test.ts`. Sorting again on this side
          would be a second source of truth for the feature's central promise
          that could drift without either side failing. */}
      {data.groups.map((group) => (
        <div key={group.role} style={s.group}>
          <div style={s.groupHeader}>
            <span style={swatchFor(ROLE_COLOR[group.role])} />
            <span style={s.groupLabel}>{t(`smartDiff.${group.role}Label`)}</span>
            <span style={s.groupDesc}>{t(`smartDiff.${group.role}Desc`)}</span>
            <span className="tnum" style={s.groupCount}>
              {t("smartDiff.filesCount", { count: group.files.length })}
            </span>
          </div>
          <div style={s.groupFiles}>
            {group.files.map((file) => (
              <FileCard
                // Keyed by path, not index: the list re-orders whenever a review
                // lands and a file gains findings.
                key={file.path}
                file={toPrFile(file, patches)}
                // No `commenting`: inline commenting stays an original-mode
                // capability, so smart mode cannot post to GitHub by accident.
                smart={{
                  findings: file.findings,
                  isLarge: file.is_large,
                  // DERIVED at mount from the URL, never synced into it with an
                  // effect: "which card is open" has one owner — `FileCard`'s
                  // own state — and the selection only sets its initial value.
                  // The role policy still opens everything it opened before; the
                  // selected file is added to that set, never subtracted from it.
                  defaultOpen:
                    file.path === selectedPath || !COLLAPSED_ROLES.includes(group.role),
                  onOpenFinding,
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

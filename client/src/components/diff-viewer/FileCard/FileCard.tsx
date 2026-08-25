/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV, type Severity } from "@devdigest/ui";
import type { PrFile } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import {
  findingsForLine,
  mostSevere,
  partitionFindings,
  renderedLineNumbers,
  severityTagLabel,
  type SmartFileView,
} from "../findings";
import { s, chevronFor, unanchoredChipFor } from "../styles";
import { CodeLine } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export function FileCard({
  file,
  commenting,
  smart,
}: {
  file: PrFile;
  commenting?: DiffCommentApi;
  /** Smart Diff only. Absent → this card renders exactly as it always has. */
  smart?: SmartFileView;
}) {
  const t = useTranslations("shell");
  // Smart Diff's ROLE policy outranks the size rule: a one-line lock-file bump
  // is small, and "Boilerplate starts collapsed" has to hold anyway.
  const [open, setOpen] = React.useState(
    smart?.defaultOpen ??
      ((file.additions ?? 0) + (file.deletions ?? 0) <= AUTO_EXPAND_MAX_LINES)
  );
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);

  // Same split as comments: findings that land on a rendered line vs. ones no
  // line can host. On seed data (`patch: null`) every finding is unanchored, so
  // this is the normal path, not a fallback.
  const smartFindings = smart?.findings;
  const { anchored, unanchored } = React.useMemo(
    () => partitionFindings(smartFindings ?? [], renderedLineNumbers(lines)),
    [smartFindings, lines],
  );

  // Where the header badge sends the reader. Derived in render, never stored:
  // a stored copy goes stale the moment a run lands and the file gains a
  // blocker. `null` when this file has no findings, which is also what hides
  // the badge — one condition, so the badge and its destination cannot disagree.
  const worstFinding = mostSevere(smartFindings ?? []);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  return (
    // `data-file-path` is the ONE addition the review-focus deep link needed on
    // this shared card: which file a card is for is otherwise readable only from
    // its rendered text, and `?file=<path>` has to be checkable against a
    // specific card. It is an attribute, not a new prop — the card's behaviour
    // is unchanged, and Smart Diff already decides what is open through
    // `smart.defaultOpen`.
    <div style={s.fileCard} data-file-path={file.path}>
      <div onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={s.filePath}>
          {file.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {commentCount > 0 && (
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-muted)" }}
          >
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
        {smart && smart.isLarge && (
          <span style={s.largeChip}>
            <Icon.AlertTriangle size={11} />
            {t("diffViewer.largeFile")}
          </span>
        )}
        {smart && worstFinding && (
          /* The badge is a DESTINATION, not a disclosure control.
             `onOpenFinding` navigates to `?tab=findings&finding=<id>`, where the
             panel un-filters, expands and scrolls to that card — the same chain
             the per-line severity tags and the unanchored chips below already
             use. It used to call `setOpen(true)` instead, which made the most
             prominent finding affordance in Smart Diff the only one that went
             nowhere; the file header itself still toggles the card, so nothing
             was lost by taking that job off the badge.
             `stopPropagation` stays: without it the header's own toggle fires on
             the way out and the card is left in the opposite state for the
             reader who presses Back.
             It targets the file's MOST SEVERE finding, by the same rule that
             colours a line's rail (`mostSevere`) — one badge cannot open three
             cards, and opening a SUGGESTION while a blocker sits in the same
             file is the silent downgrade that rule exists to prevent. */
          <button
            type="button"
            title={worstFinding.title}
            /* Its OWN accessible name, not `openFinding`. The badge and the
               line tag can both point at the same finding, and two buttons
               reading "Open finding: X" leaves a screen-reader user unable to
               tell a file-level summary from a line-level tag. */
            aria-label={t("diffViewer.openFileFindings", {
              count: smart.findings.length,
              title: worstFinding.title,
            })}
            onClick={(e) => {
              e.stopPropagation();
              smart.onOpenFinding(worstFinding.id);
            }}
            style={s.findingsBadge}
          >
            <Icon.AlertOctagon size={12} />
            {t("diffViewer.findingsBadge", { count: smart.findings.length })}
          </button>
        )}
      </div>
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={i}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                findings={smart ? findingsForLine(ln, anchored) : undefined}
                onOpenFinding={smart?.onOpenFinding}
              />
            ))
          )}
          {smart && unanchored.length > 0 && (
            <div style={s.unanchoredWrap}>
              <span style={s.unanchoredTitle}>
                {t("diffViewer.unanchoredTitle", { count: unanchored.length })}
              </span>
              {unanchored.map((f) => {
                const sev = SEV[f.severity as Severity];
                return (
                  <button
                    key={f.id}
                    type="button"
                    title={f.title}
                    aria-label={t("diffViewer.openFinding", { title: f.title })}
                    onClick={() => smart.onOpenFinding(f.id)}
                    style={unanchoredChipFor(sev.c, sev.bg)}
                  >
                    {severityTagLabel(f.severity)} · {f.title}
                  </button>
                );
              })}
            </div>
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}

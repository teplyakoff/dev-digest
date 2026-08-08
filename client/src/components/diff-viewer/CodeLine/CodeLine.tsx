/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, and an inline composer. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV, type Severity } from "@devdigest/ui";
import type { SmartDiffFinding } from "@/lib/types";
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "../comments";
import { mostSevere, severityTagLabel } from "../findings";
import { type Line } from "../helpers";
import { s, lineRowFor, lineSignFor, findingRailFor, findingTagFor } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  findings,
  onOpenFinding,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  /** Smart Diff only: the findings anchored to THIS line (see ../findings.ts). */
  findings?: SmartDiffFinding[];
  onOpenFinding?: (id: string) => void;
}) {
  const t = useTranslations("shell");
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;
  // Derived in render, never mirrored into state: the rail takes its colour from
  // the most severe finding on this line.
  const anchored = findings ?? [];
  const worst = mostSevere(anchored);
  const rail = worst ? SEV[worst.severity as Severity] : null;

  return (
    <div
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={lineRowFor(ln.kind, anchored.length > 0)}>
        {rail && <span style={findingRailFor(rail.c)} />}
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {anchored.map((f) => {
          const sev = SEV[f.severity as Severity];
          const TagIcon = Icon[sev.icon];
          return (
            <button
              key={f.id}
              type="button"
              title={f.title}
              aria-label={t("diffViewer.openFinding", { title: f.title })}
              onClick={() => onOpenFinding?.(f.id)}
              style={findingTagFor(sev.c)}
            >
              <TagIcon size={11} />
              {severityTagLabel(f.severity)}
            </button>
          );
        })}
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}

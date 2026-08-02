/* FindingsPopover — the hover card behind the severity counters. Ported from
   FindingsTooltip in the design system: an absolutely positioned, scrollable
   list of slim findings, each with its severity badge, title, category, mono
   file:line ref, confidence and a two-line rationale. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SeverityBadge, CategoryTag, ConfidenceNum } from "@devdigest/ui";
import { sortBySeverity, formatLineRef, stripMd, type SlimFinding } from "./helpers";
import { s } from "./styles";

export function FindingsPopover({
  findings,
  placement = "down",
  width = 380,
}: {
  findings: readonly SlimFinding[];
  placement?: "up" | "down";
  width?: number;
}) {
  const t = useTranslations("common");
  const items = sortBySeverity(findings);
  const AlertOctagon = Icon.AlertOctagon;

  return (
    <div role="tooltip" style={s.pop(placement, width)}>
      <div style={s.popHeader}>
        <AlertOctagon size={12} />
        {t("severityCounters.count", { count: items.length })}
      </div>
      <div style={s.popBody}>
        {items.map((f, i) => (
          <div key={`${f.file}:${f.start_line}:${i}`} style={s.item(i === items.length - 1)}>
            <div style={s.itemHead}>
              <SeverityBadge severity={f.severity} compact />
              <span style={s.itemTitle}>{f.title}</span>
              <CategoryTag category={f.category} />
            </div>
            <div style={s.itemMeta}>
              <span className="mono" style={s.lineRef}>
                {formatLineRef(f)}
              </span>
              <ConfidenceNum value={f.confidence} />
            </div>
            <div style={s.rationale}>{stripMd(f.rationale)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* RunCostBadge — what one agent run cost. Ported from CostBadge in the design
   system. Deliberately TEXT, not a pill: it is metadata sitting next to scores
   and timestamps, and a filled chip would out-shout the finding counts.

   Two variants, both from this one component:
     <RunCostBadge usd={0.012} />                              → "$0.012"
     <RunCostBadge usd={0.014} tokensIn={8200} tokensOut={1300} size="lg" />
                                                               → "$0.014  8.2K→1.3K"

   `usd == null` means UNKNOWN (no run yet, or a run that never settled) and
   renders an em-dash — never "$0.00", which would read as "this was free". */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { formatCost, formatTokenFlow } from "./helpers";
import { s } from "./styles";

export function RunCostBadge({
  usd,
  tokensIn,
  tokensOut,
  size = "sm",
  muted = false,
}: {
  usd: number | null | undefined;
  /** Pass BOTH to append the "8.2K→1.3K" token flow; omit for the compact form. */
  tokensIn?: number | null;
  tokensOut?: number | null;
  size?: "sm" | "lg";
  muted?: boolean;
}) {
  const t = useTranslations("common");
  const large = size === "lg";

  if (usd == null) {
    return (
      <span className="mono" style={s.empty(large)}>
        —
      </span>
    );
  }

  const flow =
    tokensIn != null && tokensOut != null ? formatTokenFlow(tokensIn, tokensOut) : null;

  return (
    <span className="mono tnum" title={t("runCost.tooltip")} style={s.badge(large, muted)}>
      {formatCost(usd)}
      {flow && <span style={s.tokens}>{flow}</span>}
    </span>
  );
}

export default RunCostBadge;

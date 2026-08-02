/* SeverityCounters — per-severity finding counts as inline icon+count chips
   with the finding details one hover away. Ported from FindingsCell /
   RunFindings in the design system, which share this exact markup.

   `findings == null` means UNREVIEWED and renders an em-dash; so does a real
   all-zero count (a clean review) — a popup only exists when there is at least
   one finding to show. `counts` is optional: pass the server's pre-aggregated
   object when you have it (PR list), omit it to derive from `findings`. */
"use client";

import React from "react";
import { SEV, Icon } from "@devdigest/ui";
import { FindingsPopover } from "./FindingsPopover";
import {
  COUNTED_SEVERITIES,
  countBySeverity,
  hasAnyCount,
  type SeverityCounts,
  type SlimFinding,
} from "./helpers";
import { s } from "./styles";

export function SeverityCounters({
  findings,
  counts,
  placement = "down",
  width = 380,
  gap = 8,
  suffix,
}: {
  findings: readonly SlimFinding[] | null | undefined;
  counts?: SeverityCounts | null;
  /** Popup direction — "up" for rows in the bottom half of a list. */
  placement?: "up" | "down";
  width?: number;
  gap?: number;
  /** Rendered after the chips — e.g. the timeline's "· 2 blockers". */
  suffix?: React.ReactNode;
}) {
  const [hovered, setHovered] = React.useState(false);

  if (findings == null) {
    return <span style={s.dash}>—</span>;
  }

  const resolved = counts ?? countBySeverity(findings);
  if (!hasAnyCount(resolved)) {
    return <span style={s.dash}>—</span>;
  }

  return (
    <div
      style={s.wrap(gap)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {COUNTED_SEVERITIES.filter((sv) => resolved[sv] > 0).map((sv) => {
        const sev = SEV[sv];
        const I = Icon[sev.icon];
        return (
          <span key={sv} aria-label={`${resolved[sv]} ${sev.label}`} style={s.chip(sev.c)}>
            <I size={12} />
            <span className="tnum">{resolved[sv]}</span>
          </span>
        );
      })}
      {suffix != null && <span style={s.suffix}>{suffix}</span>}
      {hovered && findings.length > 0 && (
        <FindingsPopover findings={findings} placement={placement} width={width} />
      )}
    </div>
  );
}

export default SeverityCounters;

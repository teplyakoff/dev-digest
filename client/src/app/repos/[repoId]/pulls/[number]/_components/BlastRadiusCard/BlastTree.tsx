/* BlastTree — the default Blast Radius view: changed symbol → its callers →
   the routes and cron jobs downstream of it, nested so the chain is the layout
   rather than three lists that happen to be near each other.

   Ported from `blast.jsx` in the L02 design bundle. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, MonoLink } from "@devdigest/ui";
import type { BlastCallerRef, BlastCronRef, BlastEndpointRef, BlastSymbolNode } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { groupDownstream, type Downstream } from "./helpers";
import {
  chevronStyle,
  connectorElbowStyle,
  connectorVerticalStyle,
  s,
  symbolHeaderStyle,
  treeRowStyle,
} from "./styles";

interface BlastTreeProps {
  symbols: BlastSymbolNode[];
  endpoints: BlastEndpointRef[];
  crons: BlastCronRef[];
  repoFullName: string | null;
  /** The commit the caller line numbers were computed against. */
  sha: string;
}

export function BlastTree({ symbols, endpoints, crons, repoFullName, sha }: BlastTreeProps) {
  const t = useTranslations("blast");
  /**
   * Only the FIRST symbol starts open, which is the design's `{ rateLimit: true,
   * bucketKey: false }`. Symbols are sorted by caller count, so the widest-
   * reaching one is the one already expanded, and the rest stay one click away
   * instead of turning the card into a wall.
   */
  const first = symbols[0];
  const [open, setOpen] = React.useState<Record<string, boolean>>(() =>
    first ? { [keyOf(first)]: true } : {},
  );

  const grouped = React.useMemo(
    () => groupDownstream(symbols, endpoints, crons),
    [symbols, endpoints, crons],
  );

  return (
    <div style={s.tree}>
      {symbols.map((sym) => {
        const k = keyOf(sym);
        const isOpen = !!open[k];
        const down: Downstream = grouped.byFile.get(sym.file) ?? { endpoints: [], crons: [] };
        return (
          <div key={k}>
            <button
              type="button"
              aria-expanded={isOpen}
              style={symbolHeaderStyle(isOpen)}
              onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))}
            >
              <Icon.ChevronRight size={13} style={chevronStyle(isOpen)} />
              <Icon.Code size={13} style={s.symbolIcon} />
              <span className="mono" style={s.symbolName}>
                {sym.name}()
              </span>
              <span style={s.symbolCount}>
                {t("callerCount", { count: sym.callers.length })}
                {/* Only when the facade's per-symbol cap actually bit. */}
                {sym.callers_total > sym.callers.length &&
                  ` · ${t("callersCapped", { shown: sym.callers.length, total: sym.callers_total })}`}
              </span>
            </button>

            {isOpen && (
              <div style={s.symbolBody}>
                {sym.callers.length === 0 ? (
                  <div style={s.noCallers}>{t("empty.noCallersForSymbol")}</div>
                ) : (
                  sym.callers.map((c, i) => (
                    <CallerRow
                      key={`${c.file}:${c.line}`}
                      caller={c}
                      repoFullName={repoFullName}
                      sha={sha}
                      last={i === sym.callers.length - 1 && down.endpoints.length === 0}
                    />
                  ))
                )}

                {down.endpoints.length > 0 && (
                  <div style={s.chipRow}>
                    {down.endpoints.map((e) => (
                      <Badge
                        key={`${e.route}|${e.file}`}
                        mono
                        icon="Globe"
                        color="var(--accent-text)"
                        bg="var(--accent-bg)"
                      >
                        {e.route}
                      </Badge>
                    ))}
                  </div>
                )}

                {down.crons.length > 0 && (
                  <div style={s.cronRow}>
                    {down.crons.map((c) => (
                      <Badge
                        key={`${c.name}|${c.file}`}
                        mono
                        icon="Clock"
                        color="var(--warn)"
                        bg="var(--warn-bg)"
                      >
                        {c.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Reached from a changed file that declares no symbol on screen. Shown
          rather than dropped: losing a route because the tree had nowhere to
          hang it would be a display rule quietly deleting a fact. */}
      {(grouped.orphanEndpoints.length > 0 || grouped.orphanCrons.length > 0) && (
        <div style={s.orphanGroup}>
          <div style={s.orphanLabel}>{t("elsewhere")}</div>
          <div style={s.chipRow}>
            {grouped.orphanEndpoints.map((e) => (
              <Badge
                key={`${e.route}|${e.file}`}
                mono
                icon="Globe"
                color="var(--accent-text)"
                bg="var(--accent-bg)"
              >
                {e.route}
              </Badge>
            ))}
            {grouped.orphanCrons.map((c) => (
              <Badge key={`${c.name}|${c.file}`} mono icon="Clock" color="var(--warn)" bg="var(--warn-bg)">
                {c.name}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function keyOf(sym: BlastSymbolNode): string {
  return `${sym.file}:${sym.name}`;
}

/**
 * One caller, as `file:line` linked to that exact line on GitHub.
 *
 * Pinned to the sha the line numbers were COMPUTED at, not the PR head: the two
 * are different commits and agree only while the caller's file is untouched
 * between them.
 *
 * With no repo name or sha there is no correct URL, so the same text renders
 * without an affordance — `MonoLink` with no `href` falls back to a `<button>`,
 * which would offer a click that does nothing.
 */
function CallerRow({
  caller,
  repoFullName,
  sha,
  last,
}: {
  caller: BlastCallerRef;
  repoFullName: string | null;
  sha: string;
  last: boolean;
}) {
  const label = `${caller.file}:${caller.line}`;
  return (
    <div style={treeRowStyle(1)}>
      <span style={connectorVerticalStyle(1, last)} />
      <span style={connectorElbowStyle(1)} />
      <Icon.CornerDownRight size={13} style={s.statIcon} />
      {repoFullName && sha ? (
        <MonoLink href={githubBlobUrl(repoFullName, sha, caller.file, caller.line)}>{label}</MonoLink>
      ) : (
        <span className="mono" style={s.callerPlain}>
          {label}
        </span>
      )}
      <span style={s.callerName}>{caller.symbol}</span>
    </div>
  );
}

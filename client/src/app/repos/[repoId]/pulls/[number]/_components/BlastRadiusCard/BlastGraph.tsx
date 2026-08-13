/* BlastGraph — the drill-in view: one changed symbol, its callers, and the
   routes downstream, as a hierarchical node-link diagram.

   Ported from `BlastRadiusGraph` in the L02 design bundle, with its layout
   arithmetic made safe for real data — the mock always had four callers and
   three endpoints, so the original divides by `callers.length - 1` and would
   produce `Infinity` for a symbol with one caller. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { BlastEndpointRef, BlastSymbolNode } from "@devdigest/shared";
import { columnLayout } from "./helpers";
import { s } from "./styles";

const WIDTH = 560;
const MIN_HEIGHT = 180;
/** Vertical room per caller, so a symbol with twelve does not draw them on top
    of each other the way a fixed height would. */
const ROW = 42;

interface BlastGraphProps {
  symbol: BlastSymbolNode;
  endpoints: BlastEndpointRef[];
}

export function BlastGraph({ symbol, endpoints }: BlastGraphProps) {
  const t = useTranslations("blast");
  const callers = symbol.callers;
  const height = Math.max(MIN_HEIGHT, ROW * Math.max(callers.length, endpoints.length) + 60);

  const rootY = height / 2;
  const callerYs = columnLayout(callers.length, height);
  const epYs = columnLayout(endpoints.length, height);

  return (
    <div>
      <div style={s.graphCaption}>{t("graph.subject", { symbol: symbol.name })}</div>
      <div style={s.graphScroll}>
        <svg
          width={WIDTH}
          height={height}
          role="img"
          aria-label={t("graph.ariaLabel")}
          style={s.graphSvg}
        >
          {/* Edges first, so nodes paint over them. */}
          {callerYs.map((y, i) => (
            <Edge key={`e-root-${i}`} x1={70} y1={rootY} x2={290} y2={y} />
          ))}
          {/* The design links only the first two callers to the endpoints, and
              that is honest here too: the index knows a route is downstream of
              the CHANGED FILE, not which individual caller carries it, so a full
              bipartite mesh would assert edges nobody computed. */}
          {callerYs.slice(0, 2).map((cy, ci) =>
            epYs.map((ey, ei) => (
              <Edge key={`e-c${ci}-e${ei}`} x1={290} y1={cy} x2={500} y2={ey} faint />
            )),
          )}

          <Node x={70} y={rootY} width={110} label={`${symbol.name}()`} accent />
          {callers.map((c, i) => (
            <Node
              key={`n-c-${i}`}
              x={290}
              y={callerYs[i] ?? rootY}
              width={140}
              label={c.symbol || basename(c.file)}
            />
          ))}
          {endpoints.map((e, i) => (
            <Node key={`n-e-${i}`} x={500} y={epYs[i] ?? rootY} width={150} label={e.route} accent />
          ))}
        </svg>
      </div>
      <div style={s.legend}>
        <span>{t("graph.legendSymbol")}</span>
        <span>{t("graph.legendCallers")}</span>
        <span>{t("graph.legendEndpoints")}</span>
      </div>
    </div>
  );
}

function Edge({
  x1,
  y1,
  x2,
  y2,
  faint,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  faint?: boolean;
}) {
  const mid = (x1 + x2) / 2;
  return (
    <path
      d={`M${x1 + 4},${y1} C${mid},${y1} ${mid},${y2} ${x2 - 4},${y2}`}
      fill="none"
      stroke={faint ? "var(--border)" : "var(--border-strong)"}
      strokeWidth={1.5}
    />
  );
}

function Node({
  x,
  y,
  width,
  label,
  accent,
}: {
  x: number;
  y: number;
  width: number;
  label: string;
  accent?: boolean;
}) {
  // Truncated in the middle rather than the end: `GET /api/public/items` and
  // `GET /api/public/health` share a prefix, and cutting the tail makes two
  // different routes render as the same string.
  const shown = label.length > 20 ? `${label.slice(0, 9)}…${label.slice(-10)}` : label;
  return (
    <g transform={`translate(${x - width / 2},${y - 13})`}>
      <rect
        width={width}
        height={26}
        rx={6}
        fill="var(--bg-elevated)"
        stroke={accent ? "var(--accent)" : "var(--border-strong)"}
        strokeWidth={1.25}
      />
      <text
        x={width / 2}
        y={17}
        textAnchor="middle"
        fontSize={11}
        fontFamily="JetBrains Mono, monospace"
        fill="var(--text-primary)"
      >
        {shown}
      </text>
      <title>{label}</title>
    </g>
  );
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

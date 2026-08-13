/* BlastTab — the Blast Radius tab on the PR page: the symbols this diff
   declares, who calls them, and the HTTP routes and cron jobs downstream of
   both.

   It owns the fetch (`usePrBlast`), the three states the map can be in, and the
   file:line links out to GitHub. It owns no analysis: every node and edge below
   was computed by the server from the persistent code index, and there is
   nothing here for a model to have written. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SectionLabel, Skeleton, ErrorState, EmptyState, MonoLink } from "@devdigest/ui";
import type { BlastCallerRef, BlastSymbolNode } from "@devdigest/shared";
import { usePrBlast } from "@/lib/hooks/blast";
import { useResyncRepoIntel } from "@/lib/hooks/repo-intel";
import { githubBlobUrl } from "@/lib/github-urls";
import { notify } from "@/lib/toast";
import { depthKey, shortSha } from "./helpers";
import { chipStyle, s } from "./styles";

interface BlastTabProps {
  prId: string | null;
  /** The repo row id — what "Re-analyze" is issued against. */
  repoId: string;
  /** `owner/repo`, or null until the repo is loaded. Null disables the links. */
  repoFullName: string | null;
  /**
   * FALLBACK ONLY. Links are pinned to the map's `indexed_sha`; this is used
   * when the response carries none, which only happens on the degraded path
   * where there are no links to build anyway.
   */
  headSha: string;
}

export function BlastTab({ prId, repoId, repoFullName, headSha }: BlastTabProps) {
  const t = useTranslations("blast");
  const { data, isLoading, isError, refetch } = usePrBlast(prId);
  const resync = useResyncRepoIntel(repoId);

  if (isLoading) {
    return (
      <div style={s.loadingStack}>
        <Skeleton height={18} width={280} />
        <Skeleton height={120} />
        <Skeleton height={80} />
      </div>
    );
  }

  if (isError || !data) {
    return <ErrorState title={t("error.title")} body={t("error.body")} onRetry={() => refetch()} />;
  }

  // STATE 1 — no usable index. This is NOT an empty result, and the copy has to
  // keep those apart: the server computed nothing, so "no callers" would be a
  // claim it is in no position to make. The remedy is on the same screen.
  if (data.status === "degraded") {
    return (
      <EmptyState
        icon="Layers"
        title={t("degraded.title")}
        body={data.reason}
        cta={resync.isPending ? t("degraded.pending") : t("degraded.action")}
        ctaLoading={resync.isPending}
        onCta={() => {
          resync.mutate(undefined, {
            // 202 means "queued", not "done" — the index is built by a
            // background job, so promising a fresh map here would be a lie the
            // next render exposes.
            onSuccess: () => notify.success(t("degraded.started")),
            onError: (err: unknown) =>
              notify.error(err instanceof Error ? err.message : t("error.body")),
          });
        }}
      />
    );
  }

  // No dedup here: the server collapses `route|file` before it answers, so the
  // tab, `counts.endpoints` and the MCP tool all describe the same list. Doing
  // it again on this side is how those three drifted apart in the first place.
  const endpoints = data.endpoints;
  const crons = data.crons;
  const sha = shortSha(data.indexed_sha);
  /**
   * THE COMMIT THE LINE NUMBERS CAME FROM, not the PR's head.
   *
   * Every `line` in this map was computed by the indexer against
   * `indexed_sha`. The PR head is a different commit — usually branched from an
   * older main — so a link pinned to it lands on whatever text now occupies
   * that line number in that file. The two agree exactly when the caller's file
   * is untouched between the commits, which is most of the time and is why this
   * kind of drift ships: it is right in the demo and wrong in the case a
   * reviewer most needs it, a file that moved.
   */
  const linkSha = data.indexed_sha ?? headSha;

  return (
    <section>
      <div style={s.summaryStrip}>
        <span>{t("counts.symbols", { count: data.counts.symbols })}</span>
        {/* Rendered ONLY when the server's cap actually bit. `counts` are
            totals for the whole map while `symbols` is the capped list, so
            this is the sentence that keeps a truncated list from reading as a
            complete one — the same job `callersCapped` does per symbol. */}
        {data.symbols.length < data.counts.symbols && (
          <span style={s.sep}>
            ({t("symbolsCapped", { shown: data.symbols.length, total: data.counts.symbols })})
          </span>
        )}
        <span style={s.sep}>·</span>
        <span>{t("counts.callers", { count: data.counts.callers })}</span>
        <span style={s.sep}>·</span>
        <span>{t("counts.endpoints", { count: endpoints.length })}</span>
        {crons.length > 0 && (
          <>
            <span style={s.sep}>·</span>
            <span>{t("counts.crons", { count: crons.length })}</span>
          </>
        )}
        {sha && (
          <span className="mono" style={s.sha}>
            {t("indexedAt", { sha })}
          </span>
        )}
      </div>

      {/* STATE 2 — the index exists but is incomplete, so a missing caller
          proves nothing. The banner says exactly that and the map still
          renders: half a map with a caveat beats no map. */}
      {data.status === "partial" && data.reason && (
        <div style={s.banner}>
          <Icon.AlertTriangle size={18} style={s.bannerIcon} />
          <div>
            <div style={s.bannerTitle}>{t("partial.title")}</div>
            <div style={s.bannerBody}>{data.reason}</div>
          </div>
        </div>
      )}

      <div style={s.section}>
        <SectionLabel icon="Code">{t("sections.symbols")}</SectionLabel>
        {data.symbols.length === 0 ? (
          <div style={s.emptyLine}>{t("empty.noCallers")}</div>
        ) : (
          data.symbols.map((sym) => (
            <SymbolNode
              key={`${sym.file}:${sym.name}`}
              symbol={sym}
              repoFullName={repoFullName}
              sha={linkSha}
            />
          ))
        )}
      </div>

      <div style={s.section}>
        <SectionLabel icon="Globe">{t("sections.endpoints")}</SectionLabel>
        {endpoints.length === 0 ? (
          <div style={s.emptyLine}>{t("empty.noEndpoints", { depth: 2 })}</div>
        ) : (
          <div style={s.chipRow}>
            {endpoints.map((e) => (
              <span
                key={`${e.route}|${e.file}`}
                style={chipStyle(e.depth)}
                title={t("via", { file: e.via })}
              >
                <Icon.Globe size={13} />
                <span className="mono" style={s.chipRoute}>
                  {e.route}
                </span>
                <span style={s.chipDepth}>
                  {e.depth > 1
                    ? t("depth.many", { count: e.depth })
                    : t(`depth.${depthKey(e.depth)}`)}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {crons.length > 0 && (
        <div style={s.section}>
          <SectionLabel icon="Clock">{t("sections.crons")}</SectionLabel>
          <div style={s.chipRow}>
            {crons.map((c) => (
              <span key={`${c.name}|${c.file}`} style={chipStyle(c.depth)}>
                <Icon.Clock size={13} />
                <span className="mono" style={s.chipRoute}>
                  {c.name}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * One changed symbol and its callers, collapsible.
 *
 * Open by default when it HAS callers: the callers are the answer to the
 * question the tab exists for, and hiding them behind a click on the common
 * case turns the feature into a directory listing. A symbol nothing calls stays
 * collapsed — there is nothing under it to read.
 */
function SymbolNode({
  symbol,
  repoFullName,
  sha,
}: {
  symbol: BlastSymbolNode;
  repoFullName: string | null;
  /** The commit the caller line numbers were computed against. */
  sha: string;
}) {
  const t = useTranslations("blast");
  const [open, setOpen] = React.useState(symbol.callers.length > 0);
  const Chevron = open ? Icon.ChevronDown : Icon.ChevronRight;
  const capped = symbol.callers_total > symbol.callers.length;

  return (
    <div style={s.symbolCard}>
      <button type="button" style={s.symbolHeader} onClick={() => setOpen((v) => !v)}>
        <Chevron size={14} style={s.callerArrow} />
        <Icon.Code size={13} style={s.callerArrow} />
        <span className="mono" style={s.symbolName}>
          {symbol.name}
        </span>
        <span style={s.symbolKind}>{symbol.kind}</span>
        <span style={s.symbolCount}>
          {t("callersOf", { count: symbol.callers.length })}
          {/* Only rendered when the per-symbol cap actually bit, so a complete
              list never carries a qualifier that implies it is not complete. */}
          {capped &&
            ` · ${t("callersCapped", {
              shown: symbol.callers.length,
              total: symbol.callers_total,
            })}`}
        </span>
      </button>

      {open &&
        (symbol.callers.length === 0 ? (
          <div style={s.noCallers}>{t("empty.noCallers")}</div>
        ) : (
          <ul style={s.callerList}>
            {symbol.callers.map((c) => (
              <li key={`${c.file}:${c.line}`} style={s.callerRow}>
                <Icon.CornerDownRight size={13} style={s.callerArrow} />
                <CallerLink caller={c} repoFullName={repoFullName} sha={sha} />
                <span style={s.callerSymbol}>{c.symbol}</span>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

/**
 * `file:line`, linked to that exact line on GitHub.
 *
 * NOT linked into the in-app diff viewer, and that is forced rather than
 * chosen: a caller is by definition a file the PR does not change, so it has no
 * hunk in the diff and there is no line for the viewer to scroll to. GitHub's
 * blob view at the PR's head sha is the only target where the line number on
 * screen is the line the reader lands on.
 *
 * With no repo name or sha there is no correct URL to build, so the same text
 * renders WITHOUT an affordance — `MonoLink` with no `href` falls back to a
 * `<button>` (client/INSIGHTS.md), which would offer a click that does nothing.
 */
function CallerLink({
  caller,
  repoFullName,
  sha,
}: {
  caller: BlastCallerRef;
  repoFullName: string | null;
  sha: string;
}) {
  const t = useTranslations("blast");
  const label = `${caller.file}:${caller.line}`;

  if (!repoFullName || !sha) {
    return (
      <span className="mono" style={s.callerPlain}>
        {label}
      </span>
    );
  }
  return (
    <span title={t("openInGithub", { file: caller.file, line: caller.line })}>
      <MonoLink href={githubBlobUrl(repoFullName, sha, caller.file, caller.line)}>
        {label}
      </MonoLink>
    </span>
  );
}

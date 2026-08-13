/* BlastRadiusCard — "what else can this diff reach", on the PR's Overview tab.

   Placement, structure and every number in `styles.ts` are ported from
   `blast.jsx` + `screen_pr_detail.jsx` in the L02 design bundle
   (`_assets/L02/DevDigest Design (standalone) (3).html`), where this is the
   right-hand card of `BriefCard`, opposite Intent.

   It owns the fetch and the three states the map can be in. It owns no
   analysis: every node and edge was computed by the server from the persistent
   code index, with no model call anywhere on the path. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, EmptyState, ErrorState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import { usePrBlast } from "@/lib/hooks/blast";
import { useResyncRepoIntel } from "@/lib/hooks/repo-intel";
import { notify } from "@/lib/toast";
import { BlastGraph } from "./BlastGraph";
import { BlastTree } from "./BlastTree";
import { graphSubject, shortSha } from "./helpers";
import { s, viewTabStyle } from "./styles";

/** The two views the design specifies, and the order its switch shows them in. */
const VIEWS = ["tree", "graph"] as const;
type View = (typeof VIEWS)[number];

interface BlastRadiusCardProps {
  prId: string | null;
  /** The repo row id — what "Re-analyze" is issued against. */
  repoId: string;
  /** `owner/repo`, or null until the repo is loaded. Null disables the links. */
  repoFullName: string | null;
  /** Fallback for the link sha; only used when the map carries none, which is
      the degraded path, where there are no links anyway. */
  headSha: string;
}

export function BlastRadiusCard({ prId, repoId, repoFullName, headSha }: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const [view, setView] = React.useState<View>("tree");
  const { data, isLoading, isError, refetch } = usePrBlast(prId);
  const resync = useResyncRepoIntel(repoId);

  const body = () => {
    if (isLoading) {
      return (
        <div style={s.loadingStack}>
          <Skeleton height={16} width={240} />
          <Skeleton height={96} />
        </div>
      );
    }
    if (isError || !data) {
      return <ErrorState title={t("error.title")} body={t("error.body")} onRetry={() => refetch()} />;
    }

    // STATE 1 — no usable index. NOT an empty result: the server computed
    // nothing, so "no callers" would be a claim it is in no position to make.
    if (data.status === "degraded") {
      return (
        <EmptyState
          icon="Workflow"
          title={t("degraded.title")}
          body={data.reason}
          cta={resync.isPending ? t("degraded.pending") : t("degraded.action")}
          ctaLoading={resync.isPending}
          onCta={() =>
            resync.mutate(undefined, {
              // 202 means queued, not done — the index is built by a background
              // job, so promising a fresh map here is a lie the next render
              // exposes.
              onSuccess: () => notify.success(t("degraded.started")),
              onError: (err: unknown) =>
                notify.error(err instanceof Error ? err.message : t("error.body")),
            })
          }
        />
      );
    }

    const sha = data.indexed_sha ?? headSha;
    const subject = graphSubject(data.symbols);
    const capped = data.symbols.length < data.counts.symbols;

    return (
      <>
        <div style={s.header}>
          <div style={s.statRow}>
            <Stat icon="Code" n={data.counts.symbols} label={t("stat.symbols")} />
            <Stat icon="CornerDownRight" n={data.counts.callers} label={t("stat.callers")} />
            <Stat icon="Globe" n={data.counts.endpoints} label={t("stat.endpoints")} />
            {data.crons.length > 0 && (
              <Stat icon="Clock" n={data.crons.length} label={t("stat.crons")} />
            )}
          </div>
          {/* The switch is hidden when there is nothing to graph — a Graph tab
              that can only ever draw one lonely node is a dead control. */}
          {subject && (
            <div style={s.toggle}>
              {VIEWS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={view === k}
                  onClick={() => setView(k)}
                  style={viewTabStyle(view === k)}
                >
                  {t(`view.${k}`)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* STATE 2 — the index exists but is incomplete, so a missing caller
            proves nothing. The map still renders: half a map with the caveat
            attached beats no map. */}
        {data.status === "partial" && data.reason && (
          <div style={s.banner}>
            <Icon.AlertTriangle size={16} style={s.bannerIcon} />
            <div>
              <div style={s.bannerTitle}>{t("partial.title")}</div>
              <div style={s.bannerBody}>{data.reason}</div>
            </div>
          </div>
        )}

        {data.symbols.length === 0 ? (
          <div style={s.emptyLine}>{t("empty.noCallers")}</div>
        ) : view === "graph" && subject ? (
          <BlastGraph
            symbol={subject}
            endpoints={data.endpoints.filter((e) => e.via === subject.file)}
          />
        ) : (
          <BlastTree
            symbols={data.symbols}
            endpoints={data.endpoints}
            crons={data.crons}
            repoFullName={repoFullName}
            sha={sha}
          />
        )}

        {capped && (
          <div style={s.orphanLabel}>
            {t("symbolsCapped", { shown: data.symbols.length, total: data.counts.symbols })}
          </div>
        )}
        {data.indexed_sha && (
          <div style={s.sha}>{t("indexedAt", { sha: shortSha(data.indexed_sha) })}</div>
        )}
      </>
    );
  };

  return (
    <Card>
      <SectionLabel icon="Workflow">{t("title")}</SectionLabel>
      {body()}
    </Card>
  );
}

/** Icon · bold number · muted label, as the design's `stat()` helper renders it. */
function Stat({ icon, n, label }: { icon: "Code" | "CornerDownRight" | "Globe" | "Clock"; n: number; label: string }) {
  const I = Icon[icon];
  return (
    <span style={s.stat}>
      <I size={13} style={s.statIcon} />
      <b className="tnum" style={s.statNum}>
        {n}
      </b>
      {label}
    </span>
  );
}

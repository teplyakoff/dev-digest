/* Conventions — /repos/:repoId/conventions. Ported from screen_conv_conf.jsx
   (N7). Runs the extractor, then lets a person accept, reject or edit each
   candidate before any of it can become a skill. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { ConventionCandidate, ConventionCategory } from "@devdigest/shared";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
// Imported from the domain file, not the `hooks` barrel: frontend-architecture
// §12 forbids adding to one, and `lib/hooks/index.ts` is grandfathered rather
// than a pattern to extend.
import {
  useConventions,
  useExtractConventions,
  usePatchConvention,
  useSetAllConventionStatuses,
} from "@/lib/hooks/conventions";
import { useResyncRepoIntel } from "@/lib/hooks/repo-intel";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { SKELETON_ROWS } from "./constants";
import { acceptedCount, bulkAction, dropSummary } from "./helpers";
import { s } from "./styles";
import { ConventionCard } from "./_components/ConventionCard/ConventionCard";
import { CreateSkillModal } from "./_components/CreateSkillModal/CreateSkillModal";
import { EditConventionModal } from "./_components/EditConventionModal/EditConventionModal";

export default function ConventionsPage() {
  const t = useTranslations("conventions");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const { data, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const patch = usePatchConvention(repoId);
  const setAll = useSetAllConventionStatuses(repoId);
  const resync = useResyncRepoIntel(repoId);

  const [editing, setEditing] = React.useState<ConventionCandidate | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);
  const [scanError, setScanError] = React.useState<{ message: string; code?: string } | null>(null);

  if (repoNotFound) return <RepoNotFound />;

  const scan = data?.scan ?? null;
  const candidates = data?.candidates ?? [];
  const accepted = acceptedCount(candidates);
  // "All accepted" ignores rejections: a set where everything is either accepted
  // or explicitly rejected is done, and the button should offer to clear it.
  const allAccepted =
    candidates.length > 0 && candidates.every((c) => c.status !== "pending") && accepted > 0;

  const runExtraction = async () => {
    setScanError(null);
    try {
      await extract.mutateAsync();
    } catch (e) {
      // 409 carries a `code` the page can act on (`not_indexed` offers a
      // re-index); anything else gets the generic line rather than a leaked
      // internal string.
      const details = e instanceof ApiError ? (e.details as { code?: string } | undefined) : undefined;
      setScanError({
        message: e instanceof ApiError && e.status === 409 ? e.message : t("page.extractionFailed"),
        code: details?.code,
      });
    }
  };

  const setStatus = (candidate: ConventionCandidate, next: "accepted" | "rejected" | "pending") =>
    patch.mutate({ id: candidate.id, patch: { status: next } });

  const saveEdit = async (patchBody: { rule: string; category: ConventionCategory }) => {
    if (!editing) return;
    setEditError(null);
    try {
      await patch.mutateAsync({ id: editing.id, patch: patchBody });
      setEditing(null);
    } catch (e) {
      setEditError(e instanceof ApiError && e.status === 422 ? e.message : t("page.loadError"));
    }
  };

  const crumb = [{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }];

  return (
    <AppShell crumb={crumb}>
      {editing && (
        <EditConventionModal
          candidate={editing}
          onClose={() => {
            setEditing(null);
            setEditError(null);
          }}
          onSave={saveEdit}
          saving={patch.isPending}
          error={editError}
        />
      )}

      {creating && (
        <CreateSkillModal
          repoId={repoId}
          repoFullName={activeRepo?.full_name}
          acceptedCount={accepted}
          onClose={() => setCreating(false)}
        />
      )}

      <div style={s.page}>
        <div style={s.headerRow}>
          <div style={s.headerMain}>
            <h1 style={s.heading}>
              {t("page.headingPrefix")}
              <span className="mono" style={s.repoName}>
                {activeRepo?.full_name ?? t("page.repoFallback")}
              </span>
            </h1>
            {scan ? (
              <>
                <p style={s.subtitle}>
                  {t("page.scanSummary", {
                    sampled: scan.sampled_files.length,
                    kept: scan.kept,
                    proposed: scan.proposed,
                  })}
                </p>
                {scan.dropped.length > 0 && (
                  // On screen, not in a log: the drop rate IS the extractor's
                  // credibility, and hiding it makes the survivors look better
                  // than they are.
                  <p style={s.dropped} title={dropSummary(scan).join("\n")}>
                    {t("page.dropped", { n: scan.dropped.length })}
                  </p>
                )}
              </>
            ) : (
              <p style={s.subtitle}>{t("page.subtitle")}</p>
            )}
          </div>
          {scan && (
            <Button
              kind="secondary"
              size="sm"
              icon="RefreshCw"
              loading={extract.isPending}
              disabled={extract.isPending}
              onClick={runExtraction}
            >
              {extract.isPending ? t("page.scanning") : t("page.rescan")}
            </Button>
          )}
        </div>

        {scanError && (
          <>
            <ErrorState title={scanError.message} body={t(`errors.${scanError.code ?? "generic"}`)} />
            {/* `ErrorState`'s own button is hardcoded "Retry" and `vendor/ui` is
                frozen, so an action that is not a retry gets its own button
                rather than a misleading label. */}
            {scanError.code === "not_indexed" && (
              <div style={s.centerRow}>
                <Button
                  kind="secondary"
                  icon="RefreshCw"
                  loading={resync.isPending}
                  disabled={resync.isPending}
                  onClick={() => {
                    setScanError(null);
                    resync.mutate();
                  }}
                >
                  {t("errors.reindex")}
                </Button>
              </div>
            )}
          </>
        )}

        {isLoading && (
          <div>
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <div key={i} style={s.skeletonRow}>
                <Skeleton height={150} />
              </div>
            ))}
          </div>
        )}

        {isError && !isLoading && <ErrorState title={t("page.loadError")} onRetry={() => refetch()} />}

        {!isLoading && !isError && !scan && (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            ctaLoading={extract.isPending}
            onCta={runExtraction}
          />
        )}

        {!isLoading && scan && candidates.length === 0 && (
          <EmptyState
            icon="ListChecks"
            title={t("errors.noneSurvived", { proposed: scan.proposed })}
            body={t("errors.noneSurvivedBody")}
            cta={t("page.rescan")}
            ctaLoading={extract.isPending}
            onCta={runExtraction}
          />
        )}

        {candidates.length > 0 && (
          <>
            <div style={s.toolbar}>
              <Button
                kind="ghost"
                size="sm"
                icon={allAccepted ? "X" : "Check"}
                disabled={setAll.isPending}
                onClick={() => setAll.mutate(bulkAction(candidates, allAccepted))}
              >
                {allAccepted ? t("toolbar.deselectAll") : t("toolbar.acceptAll")}
              </Button>
              <span style={s.toolbarCount}>
                {t("toolbar.accepted", { accepted, total: candidates.length })}
              </span>
              <div style={s.toolbarRight}>
                <Button
                  kind="primary"
                  size="sm"
                  icon="Sparkles"
                  disabled={accepted === 0}
                  onClick={() => setCreating(true)}
                >
                  {t("toolbar.createSkill")}
                </Button>
              </div>
            </div>
            {candidates.map((c) => (
              <ConventionCard
                key={c.id}
                candidate={c}
                scan={scan}
                repoFullName={activeRepo?.full_name}
                busy={patch.isPending}
                onAccept={() => setStatus(c, c.status === "accepted" ? "pending" : "accepted")}
                onReject={() => setStatus(c, c.status === "rejected" ? "pending" : "rejected")}
                onEdit={() => {
                  setEditError(null);
                  setEditing(c);
                }}
              />
            ))}
          </>
        )}
      </div>
    </AppShell>
  );
}

"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, Skeleton } from "@devdigest/ui";
import { useContextCandidates, useRescanContext } from "@/lib/hooks/context";
import { formatBytes } from "../../helpers";
import { s } from "./styles";

/**
 * The `.md` files in this repo's clone, offered for import.
 *
 * The candidates come from the API through the hook — NOT from a prop the caller
 * supplies. That is deliberate: a picker asserted against handed-in data is
 * green whether or not anything ever reaches it, which is how a component can
 * pass its own test for a whole lesson without appearing in the app.
 *
 * A skipped candidate is SHOWN, with its reason, and cannot be selected.
 * Hiding it would turn "why is my file not offered?" into a question the picker
 * raises rather than answers.
 */
export function ContextImportPicker({
  repoId,
  onImport,
}: {
  repoId: string;
  onImport: (path: string) => void;
}) {
  const t = useTranslations("context");
  const { data, isLoading, isError, error } = useContextCandidates(repoId, true);
  // AC-39 — the design's "Re-index" button, reassigned. The clone moves under us
  // on every poll, so a person who has just added a file needs a way to say
  // "look again" without closing and reopening the picker.
  const rescan = useRescanContext(repoId);

  const notCloned =
    isError && (error as { code?: string; details?: { code?: string } } | null)?.details?.code ===
      "not_cloned";

  return (
    <div style={s.panel}>
      <div style={s.header}>
        <span style={s.title}>{t("picker.title")}</span>
        <Button
          size="sm"
          kind="ghost"
          icon="RefreshCw"
          loading={rescan.isPending}
          disabled={rescan.isPending}
          onClick={() => rescan.mutate()}
        >
          {t("picker.rescan")}
        </Button>
      </div>

      {isLoading && <Skeleton height={16} />}

      {isError && (
        <div role="alert" style={s.note}>
          {notCloned ? t("picker.notCloned") : t("loadError")}
        </div>
      )}

      {data && data.candidates.length === 0 && <div style={s.note}>{t("picker.empty")}</div>}

      {data && data.candidates.length > 0 && (
        <div style={s.list} role="list">
          {data.candidates.map((c) => (
            <button
              key={c.path}
              type="button"
              role="listitem"
              disabled={c.status === "skipped"}
              aria-disabled={c.status === "skipped"}
              aria-label={c.path}
              style={s.row(c.status === "skipped")}
              onClick={() => onImport(c.path)}
            >
              <Icon.FileText size={13} />
              <span style={s.path} title={c.path}>
                {c.path}
              </span>
              {/* No cast. `ImportCandidate` is a discriminated union, so
                  narrowing on `status` is what makes `reason` reachable — and
                  what makes "skipped with no reason", which used to render as
                  the string `picker.skipped.undefined`, unrepresentable. */}
              {c.status === "skipped" ? (
                <span style={s.reason}>{t(`picker.skipped.${c.reason}`)}</span>
              ) : (
                <span style={s.size}>{formatBytes(c.bytes)}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {data?.truncated && (
        <div style={s.note}>{t("picker.truncated", { count: data.candidates.length })}</div>
      )}
    </div>
  );
}

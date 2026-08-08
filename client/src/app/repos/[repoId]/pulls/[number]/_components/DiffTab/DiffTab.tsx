"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Skeleton, ErrorState } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { SmartDiffViewer } from "../SmartDiffViewer/SmartDiffViewer";
import { usePrComments, useCreatePrComment, useSmartDiff } from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";
import { s, toggleButtonFor } from "./styles";

/** Which ordering the Files tab is showing. Lives in the URL, not in state. */
export type DiffView = "smart" | "original";

/** Module level, not inline: an array built in JSX is a new value every render. */
const VIEW_OPTIONS: readonly { key: DiffView; labelKey: string }[] = [
  { key: "smart", labelKey: "smartDiff.smartOrder" },
  { key: "original", labelKey: "smartDiff.originalOrder" },
];

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** From `?view=` — absent means smart, so the sorted view is what a reviewer
      lands on. */
  view: DiffView;
  onSetView: (view: DiffView) => void;
  /** Navigates to a finding's card in the Agent runs tab. */
  onOpenFinding: (id: string) => void;
}

export function DiffTab({
  prId,
  filesCount,
  files,
  canComment,
  view,
  onSetView,
  onOpenFinding,
}: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  const smartDiff = useSmartDiff(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={s.headerRight}>
            {commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments ? "Hide comments" : "Show comments"} ({commentCount})
              </Button>
            )}
            <div style={s.toggleGroup}>
              {VIEW_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => onSetView(opt.key)}
                  style={toggleButtonFor(view === opt.key)}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          </div>
        }
      >
        {view === "smart" ? t("smartDiff.groupedByRole") : `Files changed · ${filesCount} files`}
      </SectionLabel>

      {view === "smart" ? (
        smartDiff.data ? (
          <SmartDiffViewer data={smartDiff.data} files={files} onOpenFinding={onOpenFinding} />
        ) : smartDiff.isError ? (
          <ErrorState
            title={t("smartDiff.errorTitle")}
            body={t("smartDiff.errorBody")}
            onRetry={() => smartDiff.refetch()}
          />
        ) : (
          <Skeleton height={220} style={s.loading} />
        )
      ) : (
        // Original mode is untouched: the same `DiffViewer` as before, which has
        // no way to receive findings — that is what makes "no findings in
        // original mode" structural rather than a flag.
        //
        // "Original order" means THE ORDER THE API RETURNS, and that is not PR
        // order despite what the label suggests: `getPrFiles` issues no ORDER BY
        // (`reviews/repository/pull.repo.ts:32`), so rows come back in whatever
        // order Postgres has them — insertion order, in practice. Sorting them
        // here would change a mode this feature is supposed to leave alone.
        <DiffViewer files={files} commenting={commenting} />
      )}
    </section>
  );
}

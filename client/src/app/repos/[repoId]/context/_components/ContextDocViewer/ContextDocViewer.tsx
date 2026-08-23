"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Markdown } from "@devdigest/ui";
import type { ContextDocBody } from "@/lib/types";
import { formatBytes } from "../../helpers";
import { s } from "./styles";

/**
 * One document: rendered in preview, editable in edit, saved back.
 *
 * Preview goes through the vendored `Markdown` primitive, and that is a security
 * choice rather than a styling one. The primitive renders headings, lists, code
 * fences and paragraphs and CANNOT render active content — which is exactly what
 * a viewer for text imported out of somebody else's repository needs to be.
 */
export function ContextDocViewer({
  doc,
  saving,
  saveError,
  deleting,
  onSave,
  onDelete,
}: {
  doc: ContextDocBody;
  saving: boolean;
  saveError: string | null;
  deleting: boolean;
  onSave: (body: string) => void;
  onDelete: () => void;
}) {
  const t = useTranslations("context");
  const [mode, setMode] = React.useState<"preview" | "edit">("preview");
  const [draft, setDraft] = React.useState(doc.body);
  const wasSaving = React.useRef(saving);

  // A different document means a different draft. Keying on the id rather than
  // the body so that an edit in flight is not thrown away by a refetch that
  // returns the same text.
  React.useEffect(() => {
    setDraft(doc.body);
    setMode("preview");
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back to preview on a SUCCESSFUL save only. Leaving edit mode on failure
  // would hide the text the user is about to lose.
  React.useEffect(() => {
    if (wasSaving.current && !saving && saveError === null) setMode("preview");
    wasSaving.current = saving;
  }, [saving, saveError]);

  return (
    <div style={s.panel}>
      <div style={s.header}>
        <span style={s.name} title={doc.name}>
          {doc.name}
        </span>
        <div style={s.headerRight}>
          <span style={s.meta}>
            {t("tokens", { count: doc.tokens })} · {formatBytes(doc.bytes)}
          </span>
          {mode === "preview" ? (
            <>
              <Button size="sm" onClick={() => setMode("edit")}>
                {t("mode.edit")}
              </Button>
              <Button
                size="sm"
                kind="danger"
                icon="Trash"
                loading={deleting}
                disabled={deleting}
                aria-label={t("editor.delete", { name: doc.name })}
                onClick={onDelete}
              >
                {t("editor.deleteShort")}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" kind="ghost" onClick={() => setMode("preview")}>
                {t("mode.preview")}
              </Button>
              <Button
                size="sm"
                kind="primary"
                loading={saving}
                disabled={saving}
                onClick={() => onSave(draft)}
              >
                {saving ? t("editor.saving") : t("editor.save")}
              </Button>
            </>
          )}
        </div>
      </div>

      {saveError !== null && (
        <div role="alert" style={s.error}>
          {saveError}
        </div>
      )}

      {mode === "preview" ? (
        <div style={s.body}>
          <Markdown>{doc.body}</Markdown>
        </div>
      ) : (
        <textarea
          aria-label={doc.name}
          style={s.editor(saving)}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
    </div>
  );
}

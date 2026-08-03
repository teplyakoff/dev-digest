/* ImportSkillModal — pick a file, read the preview, then decide.
   The preview is the whole feature: it shows the body in full and names every
   archive entry the server refused to open. Nothing is written until confirm. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, FormField, Icon, Modal, SelectInput, TextInput, Textarea } from "@devdigest/ui";
import type { SkillImportPreview, SkillType } from "@devdigest/shared";
import { ApiError } from "../../../../../../lib/api";
import { useImportConfirm, useImportPreview } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { TYPE_OPTIONS } from "../CreateSkillModal/constants";
import { formatBytes, readFileAsBase64 } from "./helpers";
import { s } from "./styles";

const MODAL_WIDTH = 860;

export function ImportSkillModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const toast = useToast();
  const preview = useImportPreview();
  const confirm = useImportConfirm();
  const fileInput = React.useRef<HTMLInputElement>(null);

  const [parsed, setParsed] = React.useState<SkillImportPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // The three fields a person may correct before adopting the text. The body is
  // editable too — it is theirs the moment they confirm.
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState("");

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const content_base64 = await readFileAsBase64(file);
      const result = await preview.mutateAsync({ filename: file.name, content_base64 });
      setParsed(result);
      setName(result.name);
      setDescription(result.description);
      setType(result.type);
      setBody(result.body);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    }
  };

  const submit = async () => {
    if (!parsed) return;
    setError(null);
    try {
      const skill = await confirm.mutateAsync({ ...parsed, name, description, type, body });
      toast.success(t("import.success", { name: skill.name }));
      onClose();
      router.push(`/skills/${skill.id}?tab=config`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    }
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("import.title")}
      subtitle={t("import.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {error ? (
            <span style={s.error}>{error}</span>
          ) : (
            parsed && (
              <span style={s.footerNote}>
                <Icon.Info size={13} />
                {t("import.savesDisabled")}
              </span>
            )
          )}
          <Button kind="ghost" onClick={onClose}>
            {t("import.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Upload"
            onClick={submit}
            disabled={!parsed || confirm.isPending}
          >
            {confirm.isPending ? t("import.confirming") : t("import.confirm")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <input
          ref={fileInput}
          type="file"
          accept=".md,.markdown,.zip"
          data-testid="skill-import-file"
          style={s.hiddenInput}
          onChange={(e) => void onPick(e.target.files?.[0])}
        />

        {!parsed ? (
          <div style={s.picker}>
            <Icon.Upload size={26} style={s.pickerIcon} />
            <Button
              kind="secondary"
              icon="Upload"
              onClick={() => fileInput.current?.click()}
              disabled={preview.isPending}
            >
              {preview.isPending ? t("import.parsing", { filename: "" }) : t("import.pick")}
            </Button>
            <span style={s.pickerHint}>{t("import.savesDisabled")}</span>
          </div>
        ) : (
          <>
            {parsed.warnings.length > 0 && (
              <div style={s.warning}>{parsed.warnings.join(" ")}</div>
            )}

            <section style={s.section}>
              <div style={s.sectionTitle}>
                <Icon.FileText size={14} />
                {t("import.origin.title")}
              </div>
              <div style={s.originGrid}>
                <span style={s.originLabel}>{t("import.origin.filename")}</span>
                <span className="mono">{parsed.origin.filename}</span>
                <span style={s.originLabel}>{t("import.origin.kind")}</span>
                <span>
                  {parsed.origin.kind === "archive"
                    ? t("import.origin.kindArchive")
                    : t("import.origin.kindMarkdown")}
                </span>
                <span style={s.originLabel}>{t("import.origin.bytes")}</span>
                <span className="tnum">{formatBytes(parsed.origin.bytes)}</span>
                {parsed.entry_path && (
                  <>
                    <span style={s.originLabel}>{t("import.origin.entry")}</span>
                    <span className="mono">{parsed.entry_path}</span>
                  </>
                )}
              </div>
            </section>

            <section style={s.section}>
              <div style={s.sectionTitle}>
                <Icon.Shield size={14} />
                {t("import.ignored.title")}
              </div>
              <p style={s.sectionBody}>{t("import.ignored.body")}</p>
              {parsed.ignored.length === 0 && parsed.frontmatter.dropped.length === 0 ? (
                <div style={s.ignoredNone}>{t("import.ignored.none")}</div>
              ) : (
                <div style={s.ignoredList}>
                  {parsed.ignored.map((entry) => (
                    <div key={entry.path} style={s.ignoredRow}>
                      <span className="mono" style={s.ignoredPath}>
                        {entry.path}
                      </span>
                      <span style={s.ignoredReason}>{entry.reason}</span>
                    </div>
                  ))}
                  {parsed.frontmatter.dropped.length > 0 && (
                    <div style={s.ignoredRow}>
                      <span style={s.ignoredPath}>
                        {t("import.ignored.frontmatterDropped", {
                          keys: parsed.frontmatter.dropped.join(", "),
                        })}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section style={s.section}>
              <div style={s.sectionTitle}>
                <Icon.Eye size={14} />
                {t("import.adopt.title")}
              </div>
              <p style={s.sectionBody}>{t("import.adopt.body")}</p>

              <FormField label={t("config.name")} required>
                <TextInput value={name} onChange={setName} mono />
              </FormField>
              <FormField label={t("config.description")} required>
                <TextInput value={description} onChange={setDescription} />
              </FormField>
              <FormField label={t("config.type")}>
                <SelectInput
                  value={type}
                  onChange={(v) => setType(v as SkillType)}
                  options={[...TYPE_OPTIONS]}
                />
              </FormField>
              <FormField label={t("config.body")} required>
                <Textarea value={body} onChange={setBody} rows={16} mono />
              </FormField>
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}

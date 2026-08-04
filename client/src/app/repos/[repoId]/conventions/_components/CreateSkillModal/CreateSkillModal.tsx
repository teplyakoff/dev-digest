/* CreateSkillModal — turn the accepted conventions into one skill.

   The body it opens with is built on the SERVER from `status = 'accepted'`, and
   this modal cannot widen that set: it edits text, it does not decide
   membership. That is what keeps "a rejected candidate never reaches the skill"
   one server-side assertion instead of a client invariant nobody can test. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  FormField,
  Icon,
  Modal,
  SelectInput,
  TextInput,
  Toggle,
} from "@devdigest/ui";
import type { ConventionSkillDraft, SkillType } from "@devdigest/shared";
import { SkillBodyEditor } from "@/components/skill-body-editor/SkillBodyEditor";
import { ApiError } from "@/lib/api";
import { useConventionSkillDraft, useCreateConventionSkill } from "@/lib/hooks/conventions";
import { CREATE_MODAL_WIDTH, SKILL_TYPE_OPTIONS } from "../../constants";
import { s } from "./styles";

export function CreateSkillModal({
  repoId,
  repoFullName,
  acceptedCount,
  onClose,
}: {
  repoId: string;
  repoFullName: string | null | undefined;
  acceptedCount: number;
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const router = useRouter();
  const { data: draft, isLoading, isError } = useConventionSkillDraft(repoId, true);
  const create = useCreateConventionSkill(repoId);

  // `null` until the user edits something; the server's draft is what shows
  // until then. Derived, not copied in by an effect — an effect would cost an
  // extra render and add a state machine ("has it been seeded yet?") where a
  // fallback does the same job. Once `edited` is set, a late refetch of the
  // draft cannot overwrite work in progress.
  const [edited, setEdited] = React.useState<ConventionSkillDraft | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const current = edited ?? draft ?? null;

  const patch = (over: Partial<ConventionSkillDraft>) =>
    setEdited((prev) => {
      const base = prev ?? draft;
      return base ? { ...base, ...over } : prev;
    });

  const submit = async () => {
    if (!current) return;
    setError(null);
    try {
      const skill = await create.mutateAsync(current);
      onClose();
      // Straight to the skill, because the next step — linking it to an agent
      // from the Skills tab — starts there.
      router.push(`/skills/${skill.id}?tab=config`);
    } catch (e) {
      // 409 (name taken) and 422 (nothing accepted any more) are both written
      // for a person; anything else is ours, not theirs.
      const actionable = e instanceof ApiError && (e.status === 409 || e.status === 422);
      setError(actionable ? (e as ApiError).message : t("create.failed"));
    }
  };

  const canSubmit =
    !!current &&
    current.name.trim().length >= 2 &&
    current.body.trim().length > 0 &&
    current.description.trim().length > 0;

  return (
    <Modal
      width={CREATE_MODAL_WIDTH}
      title={t("create.title")}
      subtitle={current?.name}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {error ? (
            <span style={s.error}>{error}</span>
          ) : (
            <span style={s.footerNote}>
              <Icon.GitCommit size={13} />
              {t("create.savedAs")}
              <span className="mono" style={s.footerVersion}>
                v1
              </span>
              {t("create.addedToLab")}
            </span>
          )}
          <Button kind="ghost" onClick={onClose}>
            {t("create.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Sparkles"
            disabled={!canSubmit || create.isPending}
            onClick={submit}
          >
            {create.isPending ? t("create.creating") : t("create.create")}
          </Button>
        </div>
      }
    >
      {isLoading && <div style={s.loading}>{t("create.loading")}</div>}
      {isError && <div style={s.loading}>{t("create.failed")}</div>}

      {current && (
        <div style={s.body}>
          <div style={s.banner}>
            <Icon.Wrench size={15} style={s.bannerIcon} />
            <span style={s.bannerText}>
              {t.rich("create.banner", {
                count: acceptedCount,
                repo: repoFullName ?? t("page.repoFallback"),
                b: (chunks) => <b style={s.bannerStrong}>{chunks}</b>,
                repoName: (chunks) => (
                  <span className="mono" style={s.bannerRepo}>
                    {chunks}
                  </span>
                ),
              })}
            </span>
          </div>

          <FormField label={t("create.name")} required hint={t("create.nameHint")}>
            <TextInput value={current.name} onChange={(v) => patch({ name: v })} mono />
          </FormField>
          <FormField label={t("create.description")} required>
            <TextInput value={current.description} onChange={(v) => patch({ description: v })} />
          </FormField>

          <div style={s.splitRow}>
            <div style={s.splitCell}>
              <FormField label={t("create.type")}>
                <SelectInput
                  value={current.type}
                  onChange={(v) => patch({ type: v as SkillType })}
                  options={[...SKILL_TYPE_OPTIONS]}
                />
              </FormField>
            </div>
            <div style={s.splitCell}>
              <FormField label={t("create.enabled")} hint={t("create.enabledHint")}>
                <div style={s.toggleCell}>
                  <Toggle
                    on={current.enabled}
                    onChange={() => patch({ enabled: !current.enabled })}
                    size={17}
                  />
                </div>
              </FormField>
            </div>
          </div>

          <FormField label={t("create.body")} required hint={t("create.bodyHint")}>
            <SkillBodyEditor
              value={current.body}
              onChange={(v) => patch({ body: v })}
              rows={16}
              ariaLabel={t("create.body")}
            />
          </FormField>
        </div>
      )}
    </Modal>
  );
}

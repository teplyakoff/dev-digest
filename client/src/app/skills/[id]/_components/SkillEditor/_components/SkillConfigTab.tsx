/* Config tab — the whole skill: name, description, type, body, enabled, delete.
   The body is the only field that reaches a model; the rest is metadata. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, FormField, SelectInput, TextInput, Textarea, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useDeleteSkill, useSkillUsage, useUpdateSkill } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { TYPE_OPTIONS } from "../../../../_components/SkillsListView/_components/CreateSkillModal/constants";
import { estimateTokens } from "../constants";
import { s } from "../styles";

export function SkillConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const router = useRouter();
  const update = useUpdateSkill();
  const del = useDeleteSkill();
  const { data: usage } = useSkillUsage(skill.id);

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [enabled, setEnabled] = React.useState(skill.enabled);

  // Reset the local form when switching skills in the left list.
  React.useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
    setEnabled(skill.enabled);
  }, [skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only a BODY change snapshots a new version — say which version the save will
  // produce, so the number in the hint matches the one that appears in Versions.
  const bodyChanged = body !== skill.body;
  const nextVersion = bodyChanged ? skill.version + 1 : skill.version;

  const save = () =>
    update.mutate(
      { id: skill.id, patch: { name, description, type, body, enabled } },
      { onSuccess: (data) => toast.success(t("config.saved", { version: data.version })) },
    );

  const remove = () => {
    const names = (usage ?? []).map((u) => u.agent_name).join(", ");
    const message = names
      ? t("config.danger.confirmUsed", { name: skill.name, agents: names })
      : t("config.danger.confirm", { name: skill.name });
    if (!window.confirm(message)) return;
    del.mutate(skill.id, { onSuccess: () => router.push("/skills") });
  };

  return (
    <div style={s.form}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("config.title")}</h2>
        <label style={s.enabledLabel}>
          {t("config.enabled")}
          <Toggle on={enabled} onChange={setEnabled} size={16} />
        </label>
      </div>

      <FormField label={t("config.name")} required hint={t("config.nameHint")}>
        <TextInput value={name} onChange={setName} mono />
      </FormField>

      <FormField label={t("config.description")} required hint={t("config.descriptionHint")}>
        <TextInput value={description} onChange={setDescription} />
      </FormField>

      <FormField label={t("config.type")}>
        <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={[...TYPE_OPTIONS]} />
      </FormField>

      <FormField
        label={t("config.body")}
        required
        hint={t("config.bodyHint")}
        right={
          <span className="mono" style={s.tokens}>
            {t("config.tokens", { count: estimateTokens(body).toLocaleString("en-US") })}
          </span>
        }
      >
        <Textarea value={body} onChange={setBody} rows={18} mono />
      </FormField>

      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending}>
          {update.isPending ? t("config.saving") : t("config.save")}
        </Button>
        {bodyChanged && (
          <span style={s.snapshotHint}>{t("config.snapshotHint", { version: nextVersion })}</span>
        )}
      </div>

      <div style={s.danger}>
        <div style={s.dangerText}>
          <div style={s.dangerTitle}>{t("config.danger.title")}</div>
          <div style={s.dangerBody}>{t("config.danger.body")}</div>
        </div>
        <Button kind="danger" size="sm" icon="Trash" onClick={remove} disabled={del.isPending}>
          {t("config.danger.delete")}
        </Button>
      </div>
    </div>
  );
}

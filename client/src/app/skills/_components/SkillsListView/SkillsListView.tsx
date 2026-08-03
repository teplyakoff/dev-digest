/* /skills — the Skills grid. Cards + search + add; clicking a card opens the
   read-only preview beside it, "Open editor" goes to /skills/:id. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Skeleton, Icon } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { AppShell } from "../../../../components/app-shell";
import { useSkills, useUpdateSkill } from "../../../../lib/hooks/skills";
import { SkillCard } from "../SkillCard/SkillCard";
import { filterSkills } from "../SkillCard/helpers";
import { CreateSkillModal } from "./_components/CreateSkillModal/CreateSkillModal";
import { ImportSkillModal } from "./_components/ImportSkillModal/ImportSkillModal";
import { SkillPreviewDrawer } from "./_components/SkillPreviewDrawer/SkillPreviewDrawer";
import { s } from "./styles";

type Overlay = { kind: "create" } | { kind: "import" } | null;

export function SkillsListView() {
  const t = useTranslations("skills");
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const [overlay, setOverlay] = React.useState<Overlay>(null);
  const [search, setSearch] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const list = filterSkills(skills ?? [], search);
  // Read the selection out of the live list rather than storing the object, so
  // the drawer reflects a toggle made on the card behind it.
  const selected: Skill | undefined = skills?.find((sk) => sk.id === selectedId);

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      {overlay?.kind === "create" && <CreateSkillModal onClose={() => setOverlay(null)} />}
      {overlay?.kind === "import" && <ImportSkillModal onClose={() => setOverlay(null)} />}
      {selected && <SkillPreviewDrawer skill={selected} onClose={() => setSelectedId(null)} />}

      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("page.heading")}</h1>
            <p style={s.subtitle}>{t("page.subtitle")}</p>
          </div>
          <div style={s.search}>
            <Icon.Search size={13} style={s.searchIcon} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("page.searchPlaceholder")}
              aria-label={t("page.searchPlaceholder")}
              style={s.searchInput}
            />
          </div>
          <Dropdown
            width={220}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                {t("page.addSkill")}
              </Button>
            }
            items={[
              {
                label: t("page.menu.fromScratch"),
                icon: "Edit",
                onClick: () => setOverlay({ kind: "create" }),
              },
              {
                label: t("page.menu.fromFile"),
                icon: "Upload",
                onClick: () => setOverlay({ kind: "import" }),
              },
            ]}
          />
        </div>

        {isLoading && (
          <div style={s.grid}>
            <Skeleton height={130} />
            <Skeleton height={130} />
            <Skeleton height={130} />
          </div>
        )}
        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
        {!isLoading && !isError && list.length === 0 && (
          <EmptyState
            icon="Sparkles"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => setOverlay({ kind: "create" })}
          />
        )}
        {list.length > 0 && (
          <div style={s.grid}>
            {list.map((sk) => (
              <SkillCard
                key={sk.id}
                skill={sk}
                active={sk.id === selectedId}
                usedBy={sk.used_by ?? undefined}
                onClick={() => setSelectedId(sk.id)}
                onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

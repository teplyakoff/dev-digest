/* AgentEditor — agent config (model + system prompt), the skills it loads and
   the eval set that measures it. Later lessons add Stats/CI. Tab state lives in
   ?tab=, owned by `page.tsx`; there is no local tab state here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { EvalsTab } from "./_components/EvalsTab/EvalsTab";
import { SkillsTab } from "./_components/SkillsTab/SkillsTab";
import { TABS } from "./constants";
import { s } from "./styles";

export function AgentEditor({ agent, tab, onTab }: { agent: Agent; tab: string; onTab: (t: string) => void }) {
  const t = useTranslations("agents");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));
  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={s.body}>
        {tab === "config" && <ConfigTab agent={agent} />}
        {tab === "skills" && <SkillsTab agent={agent} />}
        {/* A TABS entry without a branch here renders Config and errors on
            nothing — `VALID_TABS` would accept `?tab=evals` and the page would
            silently look fine. The two edits are one change. */}
        {tab === "evals" && <EvalsTab agent={agent} />}
      </div>
    </div>
  );
}

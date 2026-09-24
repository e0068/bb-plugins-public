// Секции страницы настроек плагина: общее на все flow — ширина кнопки этапа, выбор flow агентом и корневой навык,
// из которого агент этот выбор делает. Коллекцию flow они правят тем же хранилищем, что и страница Flow.
import { useEffect, useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";

import { Icon } from "../components/ui/icon";
import { ROOT_SKILL } from "../lib/stage-constants";
import { cn } from "../lib/utils";
import type { flowSettingsRpcContract, RootSkill } from "../shared/contract";
import { LocaleProvider } from "./locale";
import { useMessages } from "./locale-context";
import { StageButtonWidth } from "./stage-settings";
import { updateFlowSettings, useFlowSettings } from "./stage-settings-store";

export function StageButtonsSection() {
  return (
    <LocaleProvider>
      <StageButtonWidth />
    </LocaleProvider>
  );
}

export function AgentFlowChoiceSection() {
  return (
    <LocaleProvider>
      <div className="flex flex-col gap-2">
        <AgentChoosesFlow />
        <RootSkillLink />
      </div>
    </LocaleProvider>
  );
}

/** Переключатель выбора flow агентом — в виде галки, как «Компактировать» в форме следующего прогона. */
function AgentChoosesFlow() {
  const t = useMessages();
  const { settings } = useFlowSettings();
  const on = settings?.agentChoosesFlow === true;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={settings === null}
      onClick={() => updateFlowSettings((s) => ({ ...s, agentChoosesFlow: !on }))}
      className={cn("flex min-h-11 items-center gap-3 rounded-lg bg-surface-recessed-solid px-3 py-2 text-left text-[13px]", on ? "text-foreground" : "text-muted-foreground")}
    >
      <span className={cn("flex size-[15px] shrink-0 items-center justify-center rounded border border-border", on && "border-foreground bg-foreground text-background")}>{on && <Icon name="Check" aria-hidden="true" className="size-2.5" />}</span>
      {t.settings.agentChoosesFlow}
    </button>
  );
}

/** Ссылка на корневой навык flow: файл открывается превью bb на хосте сервера; нет навыка — подпись, где его ждут. */
function RootSkillLink() {
  const t = useMessages();
  const rpc = useRpc<typeof flowSettingsRpcContract>();
  const navigate = useBbNavigate();
  const [root, setRoot] = useState<RootSkill | undefined>(undefined);
  useEffect(() => {
    let live = true;
    rpc.call("getRootSkill", {}).then(
      (found) => live && setRoot(found),
      () => live && setRoot(null),
    );
    return () => {
      live = false;
    };
  }, [rpc]);
  if (root === undefined) return null;
  if (root === null) return <p className="text-xs text-muted-foreground">{t.flows.rootSkillMissing}</p>;
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {t.flows.rootSkillLabel}
      <button
        type="button"
        aria-label={t.flows.rootSkill}
        onClick={() => navigate.experimental_openFilePreview({ target: { kind: "host", hostId: root.hostId, path: root.path }, location: null })}
        className="font-mono text-foreground underline-offset-2 hover:underline"
      >
        {ROOT_SKILL}
      </button>
    </p>
  );
}

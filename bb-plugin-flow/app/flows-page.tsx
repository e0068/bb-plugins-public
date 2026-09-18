// Страница Flow в левом меню bb: слева список flow, справа выбранный flow —
// имя правится на месте, ссылка на корневой навык flow, таблица его этапов и
// общая ширина кнопки этапа.
// Выбранный flow живёт в адресе страницы, чтобы ссылка открывала его. На узком
// экране страница не сжимает таблицу, а листается вбок: 46rem хватает широкой
// раскладке таблицы (контейнер от 44rem) вместе с отступом справа.
import { useEffect, useState } from "react";
import { useBbNavigate, useRpc, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";

import { addFlow, flowById, newFlow, removeFlow, renameFlow } from "../core/flows";
import { Icon } from "../components/ui/icon";
import { Input } from "../components/ui/input";
import { ROOT_SKILL } from "../lib/stage-constants";
import { cn } from "../lib/utils";
import type { Flow, flowSettingsRpcContract, RootSkill } from "../shared/contract";
import { LocaleProvider } from "./locale";
import { ProviderLogosProvider } from "./provider-logos-source";
import { useMessages } from "./locale-context";
import { updateFlowSettings, useFlowSettings } from "./stage-settings-store";
import { StageButtonWidth, WorkStagesTable } from "./stage-settings";

export const FLOWS_PANEL_PATH = "flows";

const newFlowId = (): string => `flow-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function FlowsPage(props: PluginNavPanelProps) {
  return (
    <LocaleProvider>
      <ProviderLogosProvider>
        <Flows {...props} />
      </ProviderLogosProvider>
    </LocaleProvider>
  );
}

function FlowName({ flow }: { flow: Flow }) {
  const t = useMessages();
  const [name, setName] = useState<string | null>(null);
  const save = () => {
    if (name !== null) updateFlowSettings((s) => renameFlow(s, flow.id, name));
    setName(null);
  };
  return (
    <Input
      aria-label={t.flows.name}
      value={name ?? flow.name}
      onChange={(e) => setName(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className="h-9 min-h-9 min-w-0 flex-1 rounded-md border-0 bg-card px-2.5 py-0 text-lg font-semibold shadow-none focus-visible:ring-1"
    />
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

function Flows({ subPath }: PluginNavPanelProps) {
  const t = useMessages();
  const navigate = useBbNavigate();
  const { settings } = useFlowSettings();
  const [selected, setSelected] = useState(subPath);
  // Назад и вперёд браузера меняют адрес — выбор идёт за ним.
  useEffect(() => setSelected(subPath), [subPath]);
  if (settings === null) return <div aria-busy="true" className="p-6" />;
  const flow = flowById(settings, selected);
  const open = (id: string) => {
    setSelected(id);
    navigate.toPluginPanel(FLOWS_PANEL_PATH, { subPath: id });
  };
  const create = () => {
    const id = newFlowId();
    updateFlowSettings((s) => addFlow(s, newFlow(id, t.flows.newName)));
    open(id);
  };
  return (
    <div className="flex h-full min-h-0 gap-6 p-6 max-md:gap-4 max-md:overflow-x-auto max-md:pr-0">
      <nav aria-label={t.flows.list} className="flex w-52 shrink-0 flex-col gap-0.5 max-md:w-36">
        {settings.flows.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={item.id === flow.id ? "page" : undefined}
            onClick={() => open(item.id)}
            className={cn("flex h-8 items-center rounded-md px-2 text-left text-[13px] hover:bg-state-hover", item.id === flow.id && "bg-state-active font-medium")}
          >
            <span className="truncate">{item.name}</span>
          </button>
        ))}
        <button type="button" onClick={create} className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-state-hover hover:text-foreground">
          <Icon name="Plus" aria-hidden="true" className="size-3.5" />
          {t.flows.add}
        </button>
      </nav>
      <section className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto max-md:min-w-[46rem] max-md:pr-6">
        <div className="flex items-center gap-2">
          <FlowName key={flow.id} flow={flow} />
          {settings.flows.length > 1 && (
            <button
              type="button"
              aria-label={t.flows.remove(flow.name)}
              onClick={() => updateFlowSettings((s) => removeFlow(s, flow.id))}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
            >
              <Icon name="X" aria-hidden="true" className="size-4" />
            </button>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-[13px] font-medium">{t.settings.stagesTitle}</h2>
          <p className="text-xs text-muted-foreground">{t.settings.stagesDescription}</p>
          <RootSkillLink />
          <WorkStagesTable flowId={flow.id} />
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-[13px] font-medium">{t.settings.buttonsTitle}</h2>
          <StageButtonWidth />
        </div>
      </section>
    </div>
  );
}

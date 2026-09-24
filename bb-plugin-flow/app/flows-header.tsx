// Шапка панели Flow: вкладка истории прогонов, за ней лента flow во всю
// свободную ширину титул-бара — не помещается, листается вбок — и создание
// нового в её конце. Хост монтирует шапку отдельно от страницы, и стейт
// страницы ей недоступен — общий у них только адрес панели: клик по flow пишет
// его в `subPath`, а страница читает тот же адрес обратно. Подсветка идёт за
// `flowById`, как и содержимое страницы: удалённый из адреса flow обе стороны
// читают как flow по умолчанию, и лента не остаётся без текущего.
import { useBbNavigate, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";

import { addFlow, flowById, newFlow } from "../core/flows";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import { FLOWS_PANEL_PATH } from "./flows-page";
import { HISTORY_SUB_PATH } from "./run-history";
import { LocaleProvider } from "./locale";
import { useMessages } from "./locale-context";
import { updateFlowSettings, useFlowSettings } from "./stage-settings-store";

const TAB = "flex h-7 max-w-48 shrink-0 items-center rounded-md px-2.5 text-[13px] text-muted-foreground hover:bg-state-hover hover:text-foreground";
const ACTIVE_TAB = "bg-state-active font-medium text-foreground";

const newFlowId = (): string => `flow-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function FlowsHeader(props: PluginNavPanelProps) {
  return (
    <LocaleProvider>
      <Strip {...props} />
    </LocaleProvider>
  );
}

function Strip({ subPath }: PluginNavPanelProps) {
  const t = useMessages();
  const navigate = useBbNavigate();
  const { settings } = useFlowSettings();
  if (settings === null) return null;
  const history = subPath === HISTORY_SUB_PATH;
  const current = history ? null : flowById(settings, subPath);
  const open = (id: string) => navigate.toPluginPanel(FLOWS_PANEL_PATH, { subPath: id });
  const create = () => {
    const id = newFlowId();
    updateFlowSettings((s) => addFlow(s, newFlow(id, t.flows.newName)));
    open(id);
  };
  return (
    <nav aria-label={t.flows.list} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
      <button
        type="button"
        aria-current={history ? "page" : undefined}
        onClick={() => open(HISTORY_SUB_PATH)}
        className={cn(TAB, "gap-1.5", history && ACTIVE_TAB)}
      >
        <Icon name="Clock" aria-hidden="true" className="size-3.5" />
        <span>{t.history.tab}</span>
      </button>
      {settings.flows.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-current={item.id === current?.id ? "page" : undefined}
          onClick={() => open(item.id)}
          title={item.name}
          className={cn(TAB, item.id === current?.id && ACTIVE_TAB)}
        >
          <span className="truncate">{item.name}</span>
        </button>
      ))}
      <button
        type="button"
        aria-label={t.flows.add}
        title={t.flows.add}
        onClick={create}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
      >
        <Icon name="Plus" aria-hidden="true" className="size-4" />
      </button>
    </nav>
  );
}

// Список flow слева на странице Flow: первой строкой — «Без flow», встроенная и неудаляемая, за ней плоско каждый flow ровно
// один раз в порядке коллекции, — без «Истории» (она в шапке страницы) и без отступов вложенности. Строка — значок flow, имя и справа число flow, в которых он стоит строкой «Flow»; с их
// именами в подсказке, при нуле числа нет. «Новый flow» — кнопка во всю ширину колонки под списком. Клик пишет flow в `subPath`
// панели, страница читает тот же адрес обратно; подсветка идёт за `flowById`, как и содержимое. Саму папку задаёт секция
// настроек плагина.
import { useBbNavigate, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";

import { freeFlowName } from "../core/flow-files";
import { addFlow, flowById, flowHolders, newFlow, NO_FLOW } from "../core/flows";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import { FLOWS_PANEL_PATH } from "../lib/panel-path";
import { HISTORY_SUB_PATH } from "./run-history";
import { FlowGlyph } from "./flow-glyph";
import { useMessages } from "./locale-context";
import { updateFlowSettings, useFlowSettings } from "./stage-settings-store";

const ROW = "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2.5 text-left text-[13px] text-muted-foreground hover:bg-state-hover hover:text-foreground";
const ACTIVE_ROW = "bg-state-active font-medium text-foreground";

export const newFlowId = (): string => `flow-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function FlowsList({ subPath, className }: Pick<PluginNavPanelProps, "subPath"> & { className?: string }) {
  return (
    <aside className={cn("flex min-w-0 flex-col", className)}>
      <FlowsNav subPath={subPath} />
    </aside>
  );
}

function FlowsNav({ subPath }: Pick<PluginNavPanelProps, "subPath">) {
  const t = useMessages();
  const navigate = useBbNavigate();
  const { settings } = useFlowSettings();
  if (settings === null) return null;
  // На истории и на «Без flow» ни один flow не выбран: `flowById` вернул бы первый, а подсвечивать его нельзя.
  const current = subPath === HISTORY_SUB_PATH || subPath === NO_FLOW ? null : flowById(settings, subPath);
  const open = (id: string) => navigate.toPluginPanel(FLOWS_PANEL_PATH, { subPath: id });
  const create = () => {
    const id = newFlowId();
    updateFlowSettings((s) => addFlow(s, newFlow(id, freeFlowName(s.flows, t.flows.newName))));
    open(id);
  };
  return (
    <nav aria-label={t.flows.list} className="flex flex-col gap-0.5">
      <button type="button" aria-current={subPath === NO_FLOW ? "page" : undefined} onClick={() => open(NO_FLOW)} title={t.flows.pickerNone} className={cn(ROW, subPath === NO_FLOW && ACTIVE_ROW)}>
        <FlowGlyph crossed className="size-3.5 shrink-0" />
        <span className="truncate">{t.flows.pickerNone}</span>
      </button>
      {settings.flows.map((flow) => {
        const holders = flowHolders(settings.flows, flow.id);
        return (
          <button key={flow.id} type="button" aria-current={flow.id === current?.id ? "page" : undefined} onClick={() => open(flow.id)} title={flow.name} className={cn(ROW, flow.id === current?.id && ACTIVE_ROW)}>
            <FlowGlyph icon={flow.icon} className="size-3.5 shrink-0" />
            <span className="truncate">{flow.name}</span>
            {holders.length > 0 && (
              <span title={t.flows.usedIn(holders.map((holder) => holder.name).join(", "))} className="ml-auto shrink-0 text-xs text-subtle-foreground">
                {holders.length}
              </span>
            )}
          </button>
        );
      })}
      <Button variant="secondary" size="sm" onClick={create} className="mt-1 w-full">
        <Icon name="Plus" aria-hidden="true" className="size-4" />
        {t.flows.add}
      </Button>
    </nav>
  );
}

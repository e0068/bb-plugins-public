// Список flow слева на странице Flow и в панели тредов: первыми строками — «Без flow» и «Автоматически», встроенные,
// неудаляемые и закреплённые, за ними плоско каждый flow ровно один раз в порядке коллекции, — без «Истории» (она в шапке
// страницы) и без отступов вложенности. Строка — значок flow, имя и справа число flow, в которых он стоит строкой «Flow»; с их
// именами в подсказке, при нуле числа нет. Строку flow можно перетащить за ручку в полосе слева от значка (полоса есть у каждой строки, значок не прячется): порядок пишется в настройки,
// а первый flow остаётся flow по умолчанию. «Новый flow» — кнопка во всю ширину колонки под списком. Клик пишет flow в `subPath`
// панели, страница читает тот же адрес обратно; подсветка идёт за `flowById`, как и содержимое. Саму папку задаёт секция
// настроек плагина.
import { useRef } from "react";
import { useBbNavigate, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";

import { freeFlowName } from "../core/flow-files";
import { addFlow, AUTO_FLOW, flowById, flowHolders, newFlow, NO_FLOW } from "../core/flows";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import { FLOWS_PANEL_PATH } from "../lib/panel-path";
import { HISTORY_SUB_PATH } from "./run-history";
import { FlowGlyph } from "./flow-glyph";
import { useMessages } from "./locale-context";
import { updateFlowSettings, useFlowSettings } from "./stage-settings-store";
import { useFlowDrag } from "./use-flow-drag";

const ROW = "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md pl-7 pr-2.5 text-left text-[13px] text-muted-foreground hover:bg-state-hover hover:text-foreground";
const ACTIVE_ROW = "bg-state-active font-medium text-foreground";

export const newFlowId = (): string => `flow-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function FlowsList({ subPath, className }: Pick<PluginNavPanelProps, "subPath"> & { className?: string }) {
  return (
    <aside className={cn("flex min-w-0 flex-col", className)}>
      <FlowsNav subPath={subPath} />
    </aside>
  );
}

export function FlowsNav({ subPath }: Pick<PluginNavPanelProps, "subPath">) {
  const t = useMessages();
  const navigate = useBbNavigate();
  const { settings } = useFlowSettings();
  const list = useRef<HTMLElement>(null);
  const { grab, grabbed, seam } = useFlowDrag(list, settings?.flows.map((flow) => flow.id) ?? []);
  if (settings === null) return null;
  // На истории, «Без flow» и «Автоматически» ни один flow не выбран: `flowById` вернул бы первый, а подсвечивать его нельзя.
  const current = subPath === HISTORY_SUB_PATH || subPath === NO_FLOW || subPath === AUTO_FLOW ? null : flowById(settings, subPath);
  const open = (id: string) => navigate.toPluginPanel(FLOWS_PANEL_PATH, { subPath: id });
  const create = () => {
    const id = newFlowId();
    updateFlowSettings((s) => addFlow(s, newFlow(id, freeFlowName(s.flows, t.flows.newName))));
    open(id);
  };
  return (
    <nav ref={list} aria-label={t.flows.list} className="flex flex-col gap-0.5">
      <button type="button" aria-current={subPath === NO_FLOW ? "page" : undefined} onClick={() => open(NO_FLOW)} title={t.flows.pickerNone} className={cn(ROW, subPath === NO_FLOW && ACTIVE_ROW)}>
        <FlowGlyph crossed className="size-3.5 shrink-0" />
        <span className="truncate">{t.flows.pickerNone}</span>
      </button>
      <button type="button" aria-current={subPath === AUTO_FLOW ? "page" : undefined} onClick={() => open(AUTO_FLOW)} title={t.flows.pickerAuto} className={cn(ROW, subPath === AUTO_FLOW && ACTIVE_ROW)}>
        <FlowGlyph crossed={false} className="size-3.5 shrink-0" />
        <span className="truncate">{t.flows.pickerAuto}</span>
      </button>
      {settings.flows.map((flow) => {
        const holders = flowHolders(settings.flows, flow.id);
        const side = seam?.id === flow.id ? seam.side : null;
        return (
          <div key={flow.id} data-flow-row={flow.id} {...(side === null ? {} : { "data-drop": side })} className={cn("group relative", grabbed === flow.id && "opacity-40")}>
            <button type="button" aria-current={flow.id === current?.id ? "page" : undefined} onClick={() => open(flow.id)} title={flow.name} className={cn(ROW, flow.id === current?.id && ACTIVE_ROW)}>
              <FlowGlyph icon={flow.icon} className="size-3.5 shrink-0" />
              <span className="truncate">{flow.name}</span>
              {holders.length > 0 && (
                <span title={t.flows.usedIn(holders.map((holder) => holder.name).join(", "))} className="ml-auto shrink-0 text-xs text-subtle-foreground">
                  {holders.length}
                </span>
              )}
            </button>
            <button
              type="button"
              aria-label={t.flows.drag(flow.name)}
              onPointerDown={(event) => {
                event.preventDefault();
                grab(flow.id);
              }}
              className={cn("absolute left-1 top-1/2 flex size-5 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground opacity-0 hover:text-foreground group-has-[:focus-visible]:opacity-100 group-hover:opacity-100", grabbed === flow.id && "cursor-grabbing opacity-100")}
            >
              <Icon name="DragDropVertical" aria-hidden="true" className="size-3.5" />
            </button>
            {side === "before" && <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-px border-t-2 border-primary" />}
            {side === "after" && <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 -bottom-px border-b-2 border-primary" />}
          </div>
        );
      })}
      <Button variant="secondary" size="sm" onClick={create} className="mt-1 w-full">
        <Icon name="Plus" aria-hidden="true" className="size-4" />
        {t.flows.add}
      </Button>
    </nav>
  );
}

// Кнопки модели и Flow в ряду виджета и их колонки под рядом — по прототипу владельца. Пока выбор совпадает с текущим,
// кнопка квадратная, с иконкой провайдера или flow; выбор другой — кнопка широкая: подпись сверху, иконка и название снизу,
// у предложения агента справа ✦. В колонках галочка — у выбранного, ✦ — у предложения агента всегда, «Сейчас» — у текущего,
// когда выбран другой. Правила — в ядре (../core/agent-choice.ts), здесь только разметка: классы ячеек — от «Исполнять».
import { useEffect, useState, type ReactNode } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";

import { chosenExecution, chosenFlowId, flowLook, itemMarks, modelLook, proposedExecution, switchModel, switchProvider, type CellLook, type ItemMarks } from "../core/agent-choice";
import { Icon } from "../components/ui/icon";
import { Switch } from "../components/ui/switch";
import { cn } from "../lib/utils";
import type { Execution, WidgetAgent, widgetAgentRpcContract } from "../shared/contract";
import { setExecution, setOutcomeFlow, type Draft } from "./draft";
import { FlowGlyph } from "./flow-glyph";
import { useMessages } from "./locale-context";
import { ProviderMark } from "./provider-logos";

/** Каталог выбора агента треда; пока не пришёл или не пришёл вовсе — `null`, и кнопок модели и Flow нет. `wanted: false` — каталог не нужен, запроса нет. */
export function useWidgetAgent(threadId: string, wanted = true): WidgetAgent | null {
  const rpc = useRpc<typeof widgetAgentRpcContract>();
  const [catalog, setCatalog] = useState<WidgetAgent | null>(null);
  useEffect(() => {
    if (!wanted) return undefined;
    let live = true;
    rpc.call("widgetAgent", { threadId }).then(
      (found) => live && setCatalog(found),
      () => undefined,
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- каталог читается один раз на тред, а не на новый объект клиента
  }, [threadId, wanted]);
  return catalog;
}

/** Effort модели: у модели без списка — только выбранный, иначе колонка осталась бы пустой. */
export const effortsOf = (efforts: readonly Execution["reasoningLevel"][] | undefined, chosen: Execution["reasoningLevel"]): readonly Execution["reasoningLevel"][] => (efforts === undefined || efforts.length === 0 ? [chosen] : efforts);

export const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Квадрат — та же высота, что у ячеек ряда, без подписи. */
const SQUARE = "flex-none basis-auto w-10 justify-center px-0";

/** Ячейка ряда: квадрат с иконкой или широкая с подписью над иконкой и названием, ✦ — справа. */
function AgentCell(props: { className: string; label: string; caption: string; value: string; icon: ReactNode; look: CellLook; open: boolean; disabled: boolean; onToggle: () => void }) {
  const t = useMessages();
  const name = `${props.label}: ${props.value}`;
  if (!props.look.wide)
    return (
      <button type="button" aria-label={name} title={name} aria-expanded={props.open} disabled={props.disabled} onClick={props.onToggle} className={cn(props.className, SQUARE, "hover:bg-state-hover", props.open && "bg-state-active")}>
        {props.icon}
      </button>
    );
  return (
    <button type="button" aria-label={name} aria-expanded={props.open} disabled={props.disabled} onClick={props.onToggle} className={cn(props.className, "justify-between gap-2 hover:bg-state-hover", props.open && "bg-state-active")}>
      <span className="flex min-w-0 flex-col py-0.5 leading-tight">
        <span className="truncate text-[11px] text-muted-foreground">{props.caption}</span>
        <span className="flex min-w-0 items-center gap-1 text-[13px] font-medium">
          {props.icon}
          <span className="truncate">{props.value}</span>
        </span>
      </span>
      {props.look.agent && (
        <span className="shrink-0 text-primary">
          <span aria-hidden="true">✦</span>
          <span className="sr-only">{t.agentRow.proposed}</span>
        </span>
      )}
    </button>
  );
}

/** Колонка — та же скруглённая группа, что у «Исполнять». */
const LIST_GROUP = "flex min-w-0 flex-col gap-px self-start overflow-hidden rounded-lg bg-background";

export type MarkedItem = { id: string; name: string; icon?: ReactNode; marks: ItemMarks; hint?: string; disabled?: boolean };

/** Колонка с пометками: галочка у выбранного, «Сейчас» у текущего справа, ✦ у предложения агента после названия. */
export function MarkedGroup(props: { label: string; items: readonly MarkedItem[]; onPick: (id: string) => void; footer?: ReactNode }) {
  const t = useMessages();
  return (
    <div role="group" aria-label={props.label} className={LIST_GROUP}>
      {props.items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={item.marks.on}
          disabled={item.disabled}
          onClick={() => props.onPick(item.id)}
          className="flex min-h-9 items-center justify-between gap-2 bg-state-active px-3.5 py-2 text-left text-[13px] hover:bg-state-hover disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-state-active"
        >
          <span className={cn("flex min-w-0 items-center gap-1.5", item.marks.on && "font-semibold")}>
            {item.icon}
            <span className="truncate">{item.name}</span>
            {item.marks.agent && (
              <span className="shrink-0 text-[9.5px] leading-none text-primary">
                <span aria-hidden="true">✦</span>
                <span className="sr-only">{t.agentRow.proposed}</span>
              </span>
            )}
            {item.hint !== undefined && <span className="shrink-0 text-[11px] font-normal text-muted-foreground">{item.hint}</span>}
          </span>
          {item.marks.on ? <Icon name="Check" aria-hidden="true" className="size-3.5 shrink-0" /> : item.marks.now && <span className="shrink-0 text-[11px] text-muted-foreground">{t.agentRow.now}</span>}
        </button>
      ))}
      {props.footer}
    </div>
  );
}

/** Ширина сетки — литералами: Tailwind собирает bb при установке, собранной строки в CSS не будет. */
const LIST_COLUMNS = ["", "", "@[34rem]:grid-cols-2", "@[34rem]:grid-cols-3"] as const;

type Open = "model" | "flow" | null;

/** Выбор ряда виджета, сведённый из каталога и черновика. */
const choiceOf = (catalog: WidgetAgent, draft: Draft, recommended: string | undefined) => {
  const flowId = chosenFlowId(catalog, draft.outcomeFlow === undefined ? undefined : (draft.outcomeFlow?.id ?? null), recommended);
  const proposed = proposedExecution(catalog, flowId);
  return { flowId, proposed, execution: chosenExecution(catalog, draft.execution, proposed) };
};

/**
 * Кнопки модели и Flow ряда и их колонки. `cellClass` — класс ячейки ряда «Исполнять»; `recommended` — flow, который
 * предлагает агент. Без каталога — ни кнопок, ни колонок.
 */
export function useAgentPicker(props: { catalog: WidgetAgent | null; draft: Draft; setDraft: (update: (draft: Draft) => Draft) => void; recommended: string | undefined; cellClass: string; wrapClass: (wide: boolean) => string; disabled: boolean; gap?: string; inRow?: boolean }): {
  modelCell: ReactNode;
  flowCell: ReactNode;
  lists: ReactNode;
  locked: boolean;
} {
  const t = useMessages();
  const [open, setOpen] = useState<Open>(null);
  const { catalog } = props;
  if (catalog === null) return { modelCell: null, flowCell: null, lists: null, locked: false };
  const choice = choiceOf(catalog, props.draft, props.recommended);
  const current = catalog.current;
  const chosen = choice.execution;
  const provider = catalog.providers.find((p) => p.id === chosen.providerId);
  const modelName = provider?.models.find((m) => m.model === chosen.model)?.name ?? chosen.model;
  const flow = catalog.flows.find((f) => f.id === choice.flowId);
  const toggle = (which: Exclude<Open, null>) => setOpen((now) => (now === which ? null : which));
  const pickExecution = (next: Execution) => props.setDraft((d) => setExecution(d, next, current));
  const fast = chosen.serviceTier === "fast";
  const modelLooked = modelLook(current, chosen, choice.proposed);
  const flowLooked = flowLook(catalog.currentFlowId, choice.flowId, props.recommended);
  const modelCell = (
    <div data-actions-cell className={props.wrapClass(modelLooked.wide)}>
    <AgentCell
      className={props.cellClass}
      label={t.agentRow.model}
      caption={`${t.agentRow.effortCaption(cap(chosen.reasoningLevel))}${fast ? ` · ${t.agentRow.fast}` : ""}`}
      value={modelName}
      icon={<ProviderMark providerId={chosen.providerId} framed={false} fallback="Bot" className="size-3.5 text-muted-foreground" />}
      look={modelLooked}
      open={open === "model"}
      disabled={props.disabled}
      onToggle={() => toggle("model")}
    />
    </div>
  );
  const flowCell =
    catalog.currentFlowId === null && catalog.flows.length === 0 ? null : (
      <div data-actions-cell className={props.wrapClass(flowLooked.wide)}>
      <AgentCell
        className={props.cellClass}
        label={t.agentRow.flow}
        caption={t.agentRow.flow}
        value={flow?.name ?? choice.flowId ?? "—"}
        icon={<FlowGlyph icon={flow?.icon} className="size-3.5 shrink-0 text-muted-foreground" />}
        look={flowLooked}
        open={open === "flow"}
        disabled={props.disabled}
        onToggle={() => toggle("flow")}
      />
      </div>
    );
  const columns =
    open === "model"
      ? [
          <MarkedGroup
            key="provider"
            label={t.agentRow.provider}
            items={catalog.providers.map((p) => ({
              id: p.id,
              name: p.name,
              icon: <ProviderMark providerId={p.id} framed={false} fallback="Bot" className="size-3.5 text-muted-foreground" />,
              marks: itemMarks(p.id, { chosen: chosen.providerId, current: current.providerId, proposed: choice.proposed !== null && choice.proposed.providerId !== current.providerId ? choice.proposed.providerId : null }),
              ...(p.id === current.providerId ? {} : { hint: t.agentRow.otherProvider }),
            }))}
            onPick={(id) => pickExecution(switchProvider(catalog, chosen, id))}
            footer={
              <label className="flex min-h-9 items-center justify-between gap-2 bg-state-active px-3.5 py-2 text-[13px]">
                <span>{t.agentRow.fast}</span>
                <Switch aria-label={t.agentRow.fast} checked={fast} onCheckedChange={(on) => pickExecution({ ...chosen, ...(on ? { serviceTier: "fast" as const } : { serviceTier: "default" as const }) })} />
              </label>
            }
          />,
          <MarkedGroup
            key="model"
            label={t.agentRow.model}
            items={(provider?.models ?? []).map((m) => ({
              id: m.model,
              name: m.name,
              marks: itemMarks(m.model, {
                chosen: chosen.model,
                current: chosen.providerId === current.providerId ? current.model : null,
                proposed: choice.proposed !== null && choice.proposed.providerId === chosen.providerId ? choice.proposed.model : null,
              }),
            }))}
            onPick={(id) => pickExecution(switchModel(catalog, chosen, id))}
          />,
          <MarkedGroup
            key="effort"
            label={t.agentRow.effort}
            items={effortsOf(provider?.models.find((m) => m.model === chosen.model)?.efforts, chosen.reasoningLevel).map((effort) => ({
              id: effort,
              name: cap(effort),
              marks: itemMarks(effort, { chosen: chosen.reasoningLevel, current: current.reasoningLevel, proposed: choice.proposed?.reasoningLevel ?? null }),
            }))}
            onPick={(id) => pickExecution({ ...chosen, reasoningLevel: id as Execution["reasoningLevel"] })}
          />,
        ]
      : open === "flow"
        ? [
            <MarkedGroup
              key="flow"
              label={t.agentRow.flow}
              items={catalog.flows.map((f) => ({
                id: f.id,
                name: f.name,
                icon: <FlowGlyph icon={f.icon} className="size-3.5 shrink-0 text-muted-foreground" />,
                marks: itemMarks<string | null>(f.id, { chosen: choice.flowId, current: catalog.currentFlowId, proposed: props.recommended ?? null }),
              }))}
              onPick={(id) => props.setDraft((d) => setOutcomeFlow(d, id === catalog.currentFlowId ? null : { id, name: catalog.flows.find((f) => f.id === id)?.name ?? id }))}
            />,
          ]
        : [];
  const lists = columns.length === 0 ? null : <div className={cn("grid grid-cols-1", LIST_COLUMNS[columns.length], props.gap ?? "gap-1.5", props.inRow !== true && "mt-1.5")}>{columns}</div>;
  return { modelCell, flowCell, lists, locked: chosen.providerId !== current.providerId };
}

/** Сменился ли провайдер выбором ряда — тогда «В этом треде» недоступно, работа идёт только в новом. Без каталога — нет. */
export const agentLocked = (catalog: WidgetAgent | null, draft: Draft, recommended: string | undefined): boolean =>
  catalog !== null && choiceOf(catalog, draft, recommended).execution.providerId !== catalog.current.providerId;

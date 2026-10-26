// Строка выбора flow в контейнере состояния Flow над композером треда без
// прогона и после завершённого — на месте бара и его видом. Свёрнутая говорит, какой flow выбран; раскрывается на месте, как бар,
// списком «Автоматически», flow владельца и «Без flow» с галочкой у
// выбранного; у каждого пункта знак flow из композера, у «Без flow» перечёркнутый. Выбор запоминается: flow достаётся треду с сообщением
// владельца или сразу — кнопкой «Применить» слева от шеврона, она видна, пока выбор отличается от flow треда; тогда строку сменяет бар.
// Пока сервер не ответил, строки нет.
import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";

import { AUTO_FLOW, NO_FLOW } from "../core/flows";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import type { flowChoiceRpcContract } from "../shared/contract";
import { FlowGlyph } from "./flow-glyph";
import { useLocale, useMessages } from "./locale-context";

/** Тот же такт, что у бара: строка узнаёт о выборе агента и о прогоне, начатом сообщением. */
const POLL_MS = 5000;

type Choice = { flows: Array<{ id: string; name: string; stages: number; icon?: string }>; selected: string; current?: string };

function useChoice(threadId: string, onApplied: () => void) {
  const locale = useLocale();
  const rpc = useRpc<typeof flowChoiceRpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [choice, setChoice] = useState<Choice | null>(null);
  useEffect(() => {
    let alive = true;
    const pull = () => rpcRef.current.call("threadFlowChoice", { threadId }).then((next) => alive && setChoice(next), () => undefined);
    void pull();
    const timer = setInterval(() => void pull(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [threadId]);
  const pick = (flowId: string) => {
    const before = choice;
    setChoice((current) => (current === null ? current : { ...current, selected: flowId }));
    rpcRef.current.call("pickThreadFlow", { threadId, flowId }).then(
      (answer) => answer.kind === "failed" && setChoice(before),
      () => setChoice(before),
    );
  };
  const [applying, setApplying] = useState(false);
  const apply = () => {
    setApplying(true);
    rpcRef.current.call("applyThreadFlow", { threadId, locale }).then(
      (answer) => {
        setApplying(false);
        if (answer.kind !== "applied") return;
        setChoice((current) => (current === null ? current : { ...current, current: answer.flowId }));
        onApplied();
      },
      () => setApplying(false),
    );
  };
  return { choice, pick, apply, applying };
}

export function FlowChoice({ threadId, onApplied = () => undefined }: { threadId: string; onApplied?: () => void }) {
  const t = useMessages();
  const { choice, pick, apply, applying } = useChoice(threadId, onApplied);
  const [open, setOpen] = useState(false);
  if (choice === null) return null;
  const options: Array<{ id: string; name: string; stages: number | null; icon?: string }> = [{ id: AUTO_FLOW, name: t.flows.pickerAuto, stages: null }, ...choice.flows, { id: NO_FLOW, name: t.flowChoice.none, stages: null }];
  const none = choice.selected === NO_FLOW;
  const selectedOption = options.find((option) => option.id === choice.selected);
  const selectedName = selectedOption?.name;
  const applies = choice.current !== undefined && choice.selected !== choice.current;
  return (
    // Контейнер бара: тот же отступ, скругление и подложка, последним баннером он становится шапкой композера.
    <div data-flow-choice className="mx-2.5 -mb-px overflow-hidden last:-mb-[calc(0.5rem+1px)] rounded-t-[10px] border border-b-0 border-border bg-surface-recessed-solid text-xs">
      {open && (
        <div role="radiogroup" aria-label={t.flows.pickerTitle} className="flex max-h-[50vh] flex-col gap-px overflow-y-auto overscroll-contain pt-1">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={option.id === choice.selected}
              data-flow-choice-option={option.id}
              onClick={() => {
                pick(option.id);
                setOpen(false);
              }}
              className={cn("grid min-h-7 grid-cols-[14px_14px_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-1 text-left hover:bg-state-hover", option.id === choice.selected && "font-medium")}
            >
              <span aria-hidden="true" className="flex">{option.id === choice.selected && <Icon name="Check" className="size-3.5" />}</span>
              <FlowGlyph icon={option.icon} crossed={option.id === NO_FLOW} className="size-3.5 text-muted-foreground" />
              <span className="truncate">{option.name}</span>
              {option.stages !== null && <span className="text-[11px] tabular-nums text-muted-foreground">{t.flowChoice.stages(option.stages)}</span>}
            </button>
          ))}
        </div>
      )}
      {/* «Применить» — своя кнопка поверх строки слева от шеврона: кнопка внутри кнопки-раскрывашки недопустима, а название строка не пускает под неё отступом. */}
      <div className="relative">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={cn("grid min-h-[34px] w-full grid-cols-[16px_minmax(0,1fr)_20px] items-center gap-2.5 px-3 py-1.5 text-left hover:bg-state-hover", applies && "pr-28")}
        >
          <FlowGlyph icon={selectedOption?.icon} crossed={none} className="size-3.5 text-muted-foreground" />
          <span className={cn("truncate", none && "text-muted-foreground")}>{none || selectedName === undefined ? t.flowChoice.none : t.flows.picker(selectedName)}</span>
          <Icon name="ChevronDown" aria-hidden="true" className={cn("size-3.5 text-muted-foreground", open && "rotate-180", applies && "absolute right-3")} />
        </button>
        {applies && (
          <Button type="button" variant="secondary" data-flow-apply disabled={applying} onClick={apply} className="absolute right-9 top-1/2 h-6 -translate-y-1/2 px-2 text-xs">
            {t.flowChoice.apply}
          </Button>
        )}
      </div>
    </div>
  );
}

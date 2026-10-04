// Строка выбора flow в контейнере состояния Flow над композером треда без
// прогона и после завершённого — на месте бара и его видом. Свёрнутая говорит, какой flow выбран; раскрывается на месте, как бар,
// списком «Автоматически», flow владельца и «Без flow» с галочкой у
// выбранного; у каждого пункта знак flow из композера, у «Без flow» перечёркнутый. Выбор только запоминается: flow достаётся треду с сообщением
// владельца, и тогда строку сменяет бар. Пока сервер не ответил, строки нет.
import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";

import { AUTO_FLOW, NO_FLOW } from "../core/flows";
import { FlowMark } from "../components/ui/flow-mark";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import type { flowChoiceRpcContract } from "../shared/contract";
import { useMessages } from "./locale-context";

/** Тот же такт, что у бара: строка узнаёт о выборе агента и о прогоне, начатом сообщением. */
const POLL_MS = 5000;

type Choice = { flows: Array<{ id: string; name: string; stages: number }>; selected: string };

function useChoice(threadId: string) {
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
  return { choice, pick };
}

export function FlowChoice({ threadId }: { threadId: string }) {
  const t = useMessages();
  const { choice, pick } = useChoice(threadId);
  const [open, setOpen] = useState(false);
  if (choice === null) return null;
  const options = [{ id: AUTO_FLOW, name: t.flows.pickerAuto, stages: null }, ...choice.flows, { id: NO_FLOW, name: t.flowChoice.none, stages: null }];
  const none = choice.selected === NO_FLOW;
  const selectedName = options.find((option) => option.id === choice.selected)?.name;
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
              <FlowMark crossed={option.id === NO_FLOW} className="size-3.5 text-muted-foreground" />
              <span className="truncate">{option.name}</span>
              {option.stages !== null && <span className="text-[11px] tabular-nums text-muted-foreground">{t.flowChoice.stages(option.stages)}</span>}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="grid min-h-[34px] w-full grid-cols-[16px_minmax(0,1fr)_20px] items-center gap-2.5 px-3 py-1.5 text-left hover:bg-state-hover"
      >
        <FlowMark crossed={none} className="size-3.5 text-muted-foreground" />
        <span className={cn("truncate", none && "text-muted-foreground")}>{none || selectedName === undefined ? t.flowChoice.none : t.flows.picker(selectedName)}</span>
        <Icon name="ChevronDown" aria-hidden="true" className={cn("size-3.5 text-muted-foreground", open && "rotate-180")} />
      </button>
    </div>
  );
}

// Форма следующего прогона над композером. Завершённый прогон агента не
// будит, поэтому первое слово за владельцем: его сообщение Flow придерживает в
// очереди треда, и только тогда здесь спрашивается flow и компактация. Ответ
// отпускает придержанное сообщение — сам текст форма не несёт.
import { useEffect, useRef, useState } from "react";
import { useComposerView, useRpc } from "@get-bb/plugin-sdk/app";

import { NO_FLOW } from "../core/flows";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import type { nextRunRpcContract } from "../shared/contract";
import { LocaleProvider } from "./locale";
import { useMessages } from "./locale-context";

/** Часто: форма должна встать над сообщением сразу после отправки, а вопрос — один список очереди треда. */
const POLL_MS = 1500;

type Flow = { id: string; name: string };

/** Сообщение треда придержано до выбора flow — над композером место для формы; `release` снимает форму сразу после ответа, не дожидаясь опроса. */
function useHeld(threadId: string | null): { held: boolean; release: () => void } {
  const rpc = useRpc<typeof nextRunRpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (threadId === null) return;
    let alive = true;
    const pull = () => rpcRef.current.call("nextRunHeld", { threadId }).then((answer) => alive && setHeld(answer.held), () => undefined);
    void pull();
    const timer = setInterval(() => void pull(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [threadId]);
  return { held, release: () => setHeld(false) };
}

function useFlows(threadId: string | null): Flow[] {
  const rpc = useRpc<typeof nextRunRpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [flows, setFlows] = useState<Flow[]>([]);
  useEffect(() => {
    if (threadId === null) return;
    let alive = true;
    void rpcRef.current.call("nextRunFlows", { threadId }).then((answer) => alive && setFlows(answer.flows), () => undefined);
    return () => {
      alive = false;
    };
  }, [threadId]);
  return flows;
}

export function NextFlowForm() {
  return (
    <LocaleProvider>
      <Form />
    </LocaleProvider>
  );
}

function Form() {
  const t = useMessages();
  const { scope } = useComposerView();
  const threadId = scope.kind === "thread" ? scope.threadId : null;
  const rpc = useRpc<typeof nextRunRpcContract>();
  const { held, release } = useHeld(threadId);
  const flows = useFlows(threadId);
  const [chosen, setChosen] = useState<string | null>(null);
  const [compact, setCompact] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (threadId === null || !held) return null;
  const flowId = chosen ?? flows[0]?.id ?? NO_FLOW;
  const send = () => {
    setSending(true);
    setError(null);
    void rpc
      .call("startNextRun", { threadId, flowId, compact })
      .then((answer) => (answer.kind === "sent" ? release() : setError(answer.reason)))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setSending(false));
  };
  return (
    <div data-next-flow className="mx-2.5 -mb-px overflow-hidden rounded-t-[10px] border border-b-0 border-border bg-surface-recessed-solid text-xs last:-mb-[calc(0.5rem+1px)]">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Icon name="Workflow" aria-hidden="true" className="size-3.5" />
        <span>{t.nextFlow.title}</span>
        <span className="ml-auto text-muted-foreground">{t.nextFlow.done}</span>
      </div>
      <div className="grid grid-cols-1 gap-px @[34rem]:grid-cols-2">
        {[...flows, { id: NO_FLOW, name: t.nextFlow.none }].map((flow) => (
          <button
            key={flow.id}
            type="button"
            data-next-flow-option={flow.id}
            aria-pressed={flow.id === flowId}
            onClick={() => setChosen(flow.id)}
            className={cn("flex min-h-[34px] items-center gap-2 px-3 py-1.5 text-left hover:bg-state-hover", flow.id === flowId && "bg-state-active font-medium")}
          >
            <Icon name={flow.id === NO_FLOW ? "CircleSlash" : "Workflow"} aria-hidden="true" className="size-3.5 text-muted-foreground" />
            <span className="truncate">{flow.name}</span>
          </button>
        ))}
      </div>
      {error !== null && <div className="border-t border-border px-3 py-1.5 text-destructive">{error}</div>}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center border-t border-border">
        <button type="button" data-next-flow-compact aria-pressed={compact} onClick={() => setCompact((value) => !value)} className={cn("flex items-center gap-2 px-3 py-2 text-left", compact ? "text-foreground" : "text-muted-foreground")}>
          <span className={cn("flex size-[15px] items-center justify-center rounded border border-border", compact && "border-foreground bg-foreground text-background")}>{compact && <Icon name="Check" aria-hidden="true" className="size-2.5" />}</span>
          {t.nextFlow.compact}
        </button>
        <button type="button" data-next-flow-send disabled={sending} onClick={send} className="flex min-h-[38px] items-center justify-center gap-1.5 bg-foreground px-4 font-semibold text-background disabled:opacity-50">
          {t.nextFlow.send}
        </button>
      </div>
    </div>
  );
}

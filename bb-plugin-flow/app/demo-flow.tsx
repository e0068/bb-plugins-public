// Ячейка flow в ряду кнопок Демонстрации: агент рекомендовал flow для найденных проблем, владелец оставляет его,
// выбирает другой flow или «Не переходить». Вид — как у ячейки «Исполнять»: подпись сверху, выбор под ней.
import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";

import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { Icon } from "../components/ui/icon";
import type { flowChoiceRpcContract } from "../shared/contract";
import type { Draft, OutcomeFlow } from "./draft";
import { useMessages } from "./locale-context";

/** Значение пункта «Не переходить»: id flow пустыми не бывают. */
const STAY = "";

/** Flow владельца для ячейки; пока список не пришёл или не пришёл вовсе — пусто, и ячейка зовёт рекомендацию её id. */
export function useOwnerFlows(threadId: string, wanted: boolean): readonly OutcomeFlow[] {
  const rpc = useRpc<typeof flowChoiceRpcContract>();
  const [flows, setFlows] = useState<readonly OutcomeFlow[]>([]);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    rpc.call("threadFlowChoice", { threadId }).then(
      (choice) => live && setFlows(choice.flows.map(({ id, name }) => ({ id, name }))),
      () => undefined,
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- список читается один раз на тред, а не на новый объект клиента
  }, [threadId, wanted]);
  return flows;
}

/** Flow перехода: не тронутый владельцем — рекомендованный агентом; `null` — «Не переходить». */
export const chosenFlow = (draft: Draft, recommended: string, flows: readonly OutcomeFlow[]): OutcomeFlow | null =>
  draft.outcomeFlow === undefined ? (flows.find((flow) => flow.id === recommended) ?? { id: recommended, name: recommended }) : draft.outcomeFlow;

export function FlowCell(props: { className: string; flow: OutcomeFlow | null; flows: readonly OutcomeFlow[]; disabled: boolean; onPick: (flow: OutcomeFlow | null) => void }) {
  const t = useMessages();
  const name = props.flow?.name ?? t.outcome.flowStay;
  const pick = (id: string) => props.onPick(id === STAY ? null : (props.flows.find((flow) => flow.id === id) ?? null));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={props.disabled}>
        <button type="button" aria-label={`${t.outcome.flowLabel}: ${name}`} className={props.className}>
          <span className="flex min-w-0 flex-col py-0.5 leading-tight">
            <span className="text-[11px] text-muted-foreground">{t.outcome.flowLabel}</span>
            <span className="truncate text-[13px] font-medium">{name}</span>
          </span>
          <Icon name="ChevronDown" className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" mobileTitle={t.outcome.flowLabel}>
        <DropdownMenuRadioGroup value={props.flow?.id ?? STAY} onValueChange={pick}>
          {props.flows.map((flow) => (
            <DropdownMenuRadioItem key={flow.id} value={flow.id}>
              {flow.name}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuRadioItem value={STAY}>{t.outcome.flowStay}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Кнопка flow в композере нового треда — рядом с выбором модели и того же
// вида: ghost, h-8, text-xs, без рамки и фона. Выбор запоминается сервером по
// проекту и достаётся треду, который из этого композера создадут. На узком
// экране подпись — только имя flow, без «Flow:». Последний пункт списка —
// «без flow»: тред идёт сам по себе, и на кнопке остаётся один знак плагина.
import { useEffect, useState } from "react";
import { useComposerView, useRpc } from "@get-bb/plugin-sdk/app";

import { NO_FLOW } from "../core/flows";
import { Button } from "../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import type { flowPickerRpcContract } from "../shared/contract";
import { LocaleProvider } from "./locale";
import { useMessages } from "./locale-context";

/** Знак плагина из assets/icon.svg, но цветом текста: в композере он рисуется svg, а не маской. */
const FlowMark = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-4 shrink-0">
    <path d="M6 2.25h7.25a4.25 4.25 0 0 1 0 8.5h-2.5a4.25 4.25 0 0 0 0 8.5H17" />
    <path d="M14 16.25l3 3-3 3" />
  </svg>
);

/** Классы кнопки выбора модели и effort из бандла bb. */
const PICKER_LOOK = "h-8 w-fit min-w-0 items-center justify-start gap-1.5 px-2 text-xs leading-tight border-none bg-transparent shadow-none transition-none text-muted-foreground hover:text-muted-foreground font-normal";

type Choice = { flows: { id: string; name: string }[]; selected: string };

export function FlowPicker() {
  return (
    <LocaleProvider>
      <Picker />
    </LocaleProvider>
  );
}

function Picker() {
  const { scope } = useComposerView();
  const projectId = scope.kind === "new-thread" ? scope.projectId : null;
  return projectId === null ? null : <ProjectPicker projectId={projectId} />;
}

function ProjectPicker({ projectId }: { projectId: string }) {
  const t = useMessages();
  const rpc = useRpc<typeof flowPickerRpcContract>();
  const [choice, setChoice] = useState<Choice | null>(null);
  useEffect(() => {
    let live = true;
    rpc.call("getFlowChoice", { projectId }).then(
      (next) => live && setChoice(next),
      () => live && setChoice(null),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- перечитываем при смене проекта, а не на новый объект клиента
  }, [projectId]);
  if (choice === null) return null;
  const none = choice.selected === NO_FLOW;
  const name = choice.flows.find((f) => f.id === choice.selected)?.name ?? choice.selected;
  const pick = (flowId: string) => {
    setChoice({ ...choice, selected: flowId });
    rpc.call("setFlowChoice", { projectId, flowId }).catch(() => setChoice(choice));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className={PICKER_LOOK} aria-label={none ? t.flows.pickerNone : t.flows.picker(name)} aria-description={t.flows.pickerTitle}>
          <FlowMark />
          {!none && <span className="truncate max-md:hidden">{t.flows.picker(name)}</span>}
          {!none && <span className="truncate md:hidden">{name}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t.flows.pickerTitle}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={choice.selected} onValueChange={pick}>
          {choice.flows.map((flow) => (
            <DropdownMenuRadioItem key={flow.id} value={flow.id}>
              {flow.name}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuRadioItem value={NO_FLOW}>{t.flows.pickerNone}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

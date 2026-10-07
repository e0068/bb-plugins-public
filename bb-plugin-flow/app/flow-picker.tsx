// Кнопка flow в композере нового треда — рядом с выбором модели и того же
// вида: ghost, h-8, text-xs, без рамки и фона. Выбор запоминается сервером по
// проекту и достаётся треду, который из этого композера создадут. На узком
// экране подпись — только имя flow, без «Flow:». Первый пункт списка —
// «Автоматически»: flow треду выберет агент, и на кнопке остаётся один знак
// плагина. Последний — «без flow»: тред идёт сам по себе, знак перечёркнут.
import { useEffect, useState } from "react";
import { useComposerView, useRpc } from "@get-bb/plugin-sdk/app";

import { AUTO_FLOW, NO_FLOW } from "../core/flows";
import { Button } from "../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import type { flowPickerRpcContract } from "../shared/contract";
import { FlowGlyph } from "./flow-glyph";
import { LocaleProvider } from "./locale";
import { useMessages } from "./locale-context";

/** Классы кнопки выбора модели и effort из бандла bb. */
const PICKER_LOOK = "h-8 w-fit min-w-0 items-center justify-start gap-1.5 px-2 text-xs leading-tight border-none bg-transparent shadow-none transition-none text-muted-foreground hover:text-muted-foreground font-normal";

type Choice = { flows: { id: string; name: string; icon?: string }[]; selected: string };

/**
 * Что кнопка показывала — по проекту и последнее вообще. bb монтирует её заново
 * на каждой смене проекта в композере Home; пустая до ответа сервера, она на
 * кадр-два пропадала, и панель композера прыгала вбок. Поэтому новая кнопка
 * встаёт сразу с выбором этого проекта, а в незнакомом — с последним показанным,
 * и ответ сервера подменяет его, как только придёт.
 */
const shownByProject = new Map<string, Choice>();
let lastShown: Choice | null = null;

/** Только для тестов: каждый начинает с модуля, не показавшего ни одного выбора. */
export function forgetShownFlowChoices(): void {
  shownByProject.clear();
  lastShown = null;
}

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
  const [choice, setChoice] = useState<Choice | null>(() => shownByProject.get(projectId) ?? lastShown);
  const show = (next: Choice) => {
    shownByProject.set(projectId, next);
    lastShown = next;
    setChoice(next);
  };
  useEffect(() => {
    let live = true;
    rpc.call("getFlowChoice", { projectId }).then(
      (next) => live && show(next),
      () => live && setChoice(null),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- перечитываем при смене проекта, а не на новый объект клиента
  }, [projectId]);
  if (choice === null) return null;
  const none = choice.selected === NO_FLOW;
  const auto = choice.selected === AUTO_FLOW;
  const selectedFlow = choice.flows.find((f) => f.id === choice.selected);
  const name = selectedFlow?.name ?? choice.selected;
  const label = none ? t.flows.pickerNone : auto ? t.flows.pickerAuto : t.flows.picker(name);
  const pick = (flowId: string) => {
    show({ ...choice, selected: flowId });
    rpc.call("setFlowChoice", { projectId, flowId }).catch(() => show(choice));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className={PICKER_LOOK} aria-label={label} aria-description={t.flows.pickerTitle}>
          <FlowGlyph icon={selectedFlow?.icon} crossed={none} />
          {!none && !auto && <span className="truncate max-md:hidden">{label}</span>}
          {!none && !auto && <span className="truncate md:hidden">{name}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t.flows.pickerTitle}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={choice.selected} onValueChange={pick}>
          <DropdownMenuRadioItem value={AUTO_FLOW}>
            <FlowGlyph crossed={false} />
            {t.flows.pickerAuto}
          </DropdownMenuRadioItem>
          {choice.flows.map((flow) => (
            <DropdownMenuRadioItem key={flow.id} value={flow.id}>
              <FlowGlyph icon={flow.icon} crossed={false} />
              {flow.name}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuRadioItem value={NO_FLOW}>
            <FlowGlyph crossed />
            {t.flows.pickerNone}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

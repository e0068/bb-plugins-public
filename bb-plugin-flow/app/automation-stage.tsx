// Сегмент «Скрипт» меню исполнения и теги шагов в строке таблицы этапов.
// Сегмент: наверху — кто запускает шаги, Flow сам или владелец кнопкой (этап
// Action); дальше виджеты — Вопросы, Критерии, Выбор этапов, Демонстрация;
// сохранённые наборы, шаги Flow и «Добавить скрипт…»: выбранный файл хранится в
// автоматизации и становится шагом с именем файла. Шаги встроенной — теги, как
// исполнители у этапа навыка: крест, перетаскивание, закладка «Сохранить набор».
// Шаги автоматизации Automations — теги только для чтения: они правятся там.
// Как этап переходит от одного исполнения к другому — ../core/stage-execution.
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";

import { isStepId, STEP_IDS, type StepId } from "@bb-plugins/automation-steps/catalog";
import { overlayItem } from "../components/ui/field-overlay";
import { Icon } from "../components/ui/icon";
import { NEEDS_OPEN_PR, opensPrBefore } from "../core/automation-order";
import { addScript, MAX_SCRIPT_CHARS, removeStep, scriptOf } from "../core/automation-scripts";
import { applySet, isSaved, removeSet, saveSet } from "../core/automation-sets";
import { moveItem } from "../core/reorder";
import { executionOf, withRun, withSteps, withWidget } from "../core/stage-execution";
import { BUILTIN_KINDS, BUILTIN_SKILLS, isNewStageName } from "../lib/stage-constants";
import { AUTOMATION_ICON, KIND_ICONS } from "./stage-icons";
import { Segmented } from "./segmented";
import { cn } from "../lib/utils";
import type { AutomationSet, AutomationStep, BuiltinAutomation, WorkStage } from "../shared/contract";
import { useMessages } from "./locale-context";

/** Строка меню, недоступная для уже выбранного шага. */
const menuItem = cn(overlayItem, "disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent");
const groupTitle = "px-2 pb-0.5 pt-1.5 text-[11px] text-muted-foreground";
const separator = <div role="separator" className="my-1 h-px bg-border" />;
const tag = "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md bg-card text-xs";

type ScriptFile = { name: string; content: string };

/** Сохранённые наборы и их правка — от таблицы этапов: этот модуль не тянет SDK, его импортируют до загрузки приложения. */
export type AutomationSets = { sets: readonly AutomationSet[]; update: (change: (sets: readonly AutomationSet[]) => readonly AutomationSet[]) => void };

type StageChange = (change: (stage: WorkStage) => WorkStage) => void;

/** Подпись шага автоматизации: шаг Flow — по языку интерфейса, скрипт — именем файла. */
const useStepLabel = () => {
  const t = useMessages();
  return (automation: BuiltinAutomation, id: AutomationStep): string => (isStepId(id) ? t.steps[id] : (scriptOf(automation, id)?.name ?? id));
};

const useStepLabels = () => {
  const label = useStepLabel();
  return (automation: BuiltinAutomation): string[] => automation.steps.map((id) => label(automation, id));
};

type Run = "auto" | "manual";

/** Кто запускает шаги: Flow сам или владелец кнопкой — этап Action. У виджета шагов нет, и выбора тоже. */
function RunSwitch({ manual, onChange }: { manual: boolean; onChange: (manual: boolean) => void }) {
  const t = useMessages();
  return (
    <div className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1 text-xs text-muted-foreground">
      <span>{t.settings.run}</span>
      <Segmented<Run>
        label={t.settings.run}
        value={manual ? "manual" : "auto"}
        onChange={(run) => onChange(run === "manual")}
        options={[
          { value: "auto", label: t.settings.runAuto },
          { value: "manual", label: t.settings.runManual },
        ]}
      />
    </div>
  );
}

/** Виджеты: этап-бриф ведётся навыком своего вида и виджетом в треде; отмечен тот, что стоит у этапа. */
function WidgetOptions({ stage, onChange, onDone }: { stage: WorkStage; onChange: StageChange; onDone: () => void }) {
  const t = useMessages();
  const current = executionOf(stage);
  return (
    <div role="group" aria-label={t.settings.widgets}>
      <div className={groupTitle}>{t.settings.widgets}</div>
      {BUILTIN_KINDS.map((kind) => {
        const on = current.kind === "widget" && current.widget === kind;
        return (
          <button
            key={kind}
            type="button"
            role="menuitemradio"
            aria-checked={on}
            onClick={() => {
              onChange((s) => withWidget(s, kind));
              onDone();
            }}
            className={menuItem}
          >
            <Icon name={KIND_ICONS[kind]} aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span>{t.stages[kind]}</span>
              <span className="line-clamp-1 font-mono text-[11px] text-muted-foreground">{BUILTIN_SKILLS[kind]}</span>
            </span>
            <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center rounded-full border border-border">
              {on && <span className="size-2 rounded-full bg-foreground" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Сохранённые наборы строкой своих шагов; выбор ставит их в этап, крест убирает набор из меню. */
function SetOptions({ sets, onPick }: { sets: AutomationSets; onPick: (set: AutomationSet) => void }) {
  const t = useMessages();
  const labels = useStepLabels();
  return (
    <div role="group" aria-label={t.settings.savedSets}>
      <div className={groupTitle}>{t.settings.savedSets}</div>
      {sets.sets.map((set, i) => {
        const label = labels({ source: "flow", ...set }).join(" · ");
        return (
          <div key={`${i}-${label}`} className="flex items-center gap-0.5">
            <button type="button" role="menuitem" title={label} onClick={() => onPick(set)} className={cn(menuItem, "min-w-0 flex-1")}>
              <span className="min-w-0 truncate">{label}</span>
            </button>
            <button
              type="button"
              aria-label={t.settings.removeSet(label)}
              onClick={() => sets.update((current) => removeSet(current, i))}
              className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground"
            >
              <Icon name="X" aria-hidden="true" className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Шаги Flow: уже стоящие и шаги по открытому PR раньше самого открытия недоступны; «Добавить скрипт…» открывает выбор файла. */
function StepOptions({ taken, prOpened, onPick, onScript }: { taken: readonly AutomationStep[]; prOpened: boolean; onPick: (id: StepId) => void; onScript: (file: ScriptFile) => void }) {
  const t = useMessages();
  const input = useRef<HTMLInputElement>(null);
  const [tooBig, setTooBig] = useState(false);
  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) return;
    // Символ занимает не больше четырёх байт: такой файл заведомо длиннее предела, читать его незачем.
    if (file.size > MAX_SCRIPT_CHARS * 4) return setTooBig(true);
    const content = await file.text();
    setTooBig(content.length > MAX_SCRIPT_CHARS);
    if (content.length <= MAX_SCRIPT_CHARS) onScript({ name: file.name, content });
  };
  return (
    <div role="group" aria-label={t.settings.automationSteps}>
      <div className={groupTitle}>{t.settings.automationSteps}</div>
      {STEP_IDS.map((id) => {
        // Шаг по номеру открытого PR раньше самого открытия — цепочка, падающая
        // на первом же прогоне. Такой пункт не выбрать, и подпись говорит почему.
        const needsPr = !prOpened && NEEDS_OPEN_PR.includes(id);
        const disabled = taken.includes(id) || needsPr;
        return (
          <button
            key={id}
            type="button"
            role="menuitem"
            title={needsPr ? t.settings.stepNeedsOpenPr(t.steps["git.create-pr"]) : undefined}
            aria-disabled={disabled}
            disabled={disabled}
            onClick={() => onPick(id)}
            className={menuItem}
          >
            <Icon name={AUTOMATION_ICON} aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            {t.steps[id]}
          </button>
        );
      })}
      {separator}
      <button type="button" role="menuitem" onClick={() => input.current?.click()} className={menuItem}>
        <Icon name="Code" aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        {t.settings.addScript}
      </button>
      {tooBig && <div className="px-2 py-1.5 text-xs text-destructive">{t.settings.scriptTooBig}</div>}
      <input ref={input} type="file" hidden onChange={(event) => void onFile(event)} />
    </div>
  );
}

/**
 * Сегмент «Скрипт»: запуск, виджеты, сохранённые наборы, шаги Flow и свой файл. Выбор виджета, набора или шага закрывает
 * меню — этап сменил исполнение и виден в строке; переключатель запуска меню не закрывает. Запуск выбирается только у
 * скрипта и у пустого этапа: у этапа с агентами он снял бы их одним нажатием, не показав, что снимает. Ещё не названный
 * новый этап шаги подписывают собой — через запятую.
 */
export function ScriptOptions({ stage, stages, sets, onChange, onDone }: { stage: WorkStage; stages: readonly WorkStage[]; sets: AutomationSets; onChange: StageChange; onDone: () => void }) {
  const labels = useStepLabels();
  const current = executionOf(stage);
  const automation = current.kind === "script" ? current.automation : null;
  const steps = automation?.steps ?? [];
  const runnable = current.kind === "script" || (current.kind === "executors" && current.executors.length === 0);
  const apply = (change: (automation: BuiltinAutomation) => BuiltinAutomation) => {
    onChange((s) => {
      const next = withSteps(change)(s);
      return isNewStageName(s.name) && next.automation !== undefined && "source" in next.automation ? { ...next, name: labels(next.automation).join(", ") } : next;
    });
    onDone();
  };
  return (
    <>
      {runnable && (
        <>
          <RunSwitch manual={current.kind === "script" && current.manual} onChange={(manual) => onChange((s) => withRun(s, manual))} />
          {separator}
        </>
      )}
      <WidgetOptions stage={stage} onChange={onChange} onDone={onDone} />
      {/* Набор ставится только в этап без шагов: к уже выбранным шагам его не подмешать. */}
      {sets.sets.length > 0 && steps.length === 0 && (
        <>
          {separator}
          <SetOptions sets={sets} onPick={(set) => apply(() => applySet(set, () => crypto.randomUUID()))} />
        </>
      )}
      {separator}
      <StepOptions
        taken={steps}
        prOpened={opensPrBefore(stages, stage.id)}
        onPick={(id) => apply((a) => ({ ...a, steps: [...a.steps, id] }))}
        // Id скрипта — случайный: номер, освободившийся после удаления, повтор прогона принял бы за прежний скрипт.
        onScript={(file) => apply((a) => addScript(a, file, crypto.randomUUID()))}
      />
    </>
  );
}

/** Метка этапа Action перед шагами: шаги запускает владелец кнопкой в полосе прогресса. */
export function ManualMark() {
  const t = useMessages();
  return (
    <span title={t.settings.runManualHint} className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-state-active px-2 text-xs">
      <Icon name={KIND_ICONS.action} aria-hidden="true" className="size-3" />
      {t.settings.runManual}
    </span>
  );
}

/** Теги шагов: у встроенного скрипта — крест, перетаскивание и закладка набора, у автоматизации Automations — только чтение. */
export function AutomationStepTags({ stage, sets, onChange }: { stage: WorkStage; sets: AutomationSets; onChange: StageChange }) {
  const t = useMessages();
  const [dragged, setDragged] = useState<number | null>(null);
  const label = useStepLabel();
  const current = executionOf(stage);

  if (current.kind === "external") {
    return (
      <ul title={t.settings.stepsReadOnly} className="contents">
        {(current.automation.steps ?? []).map((label, i) => (
          <li key={`${i}-${label}`} className={cn(tag, "px-2")}>
            <span className="min-w-0 truncate">{label}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (current.kind !== "script") return null;

  const automation = current.automation;
  const labelOf = (id: AutomationStep) => label(automation, id);
  const saved = isSaved(sets.sets, automation);
  const drop = (event: DragEvent, target: number) => {
    event.preventDefault();
    if (dragged !== null) onChange(withSteps((a) => ({ ...a, steps: moveItem(a.steps, dragged, target) })));
    setDragged(null);
  };
  return (
    <>
      {automation.steps.length === 0 && <span className="flex h-7 items-center px-1 text-xs text-muted-foreground">{t.settings.noSteps}</span>}
      <ul className="contents">
        {automation.steps.map((id, i) => (
          <li
            key={id}
            draggable
            aria-label={t.settings.moveStep(labelOf(id))}
            onDragStart={() => setDragged(i)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => drop(event, i)}
            onDragEnd={() => setDragged(null)}
            className={cn(tag, "cursor-grab pl-2 pr-0.5", dragged === i && "opacity-50")}
          >
            <span className="min-w-0 truncate">{labelOf(id)}</span>
            <button
              type="button"
              aria-label={t.settings.removeStep(labelOf(id))}
              onClick={() => onChange(withSteps((a) => removeStep(a, id)))}
              className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground"
            >
              <Icon name="X" aria-hidden="true" className="size-3" />
            </button>
          </li>
        ))}
      </ul>
      {automation.steps.length > 0 && (
        <button
          type="button"
          aria-label={t.settings.saveSet}
          aria-description={saved ? t.settings.setSaved : undefined}
          title={saved ? t.settings.setSaved : t.settings.saveSet}
          disabled={saved}
          onClick={() => sets.update((current) => saveSet(current, automation))}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:cursor-default disabled:text-foreground disabled:hover:bg-transparent"
        >
          <Icon name="Bookmark" aria-hidden="true" className="size-3.5" />
        </button>
      )}
    </>
  );
}

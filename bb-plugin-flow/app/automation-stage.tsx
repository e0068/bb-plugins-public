// Автоматизации в таблице этапов flow. Кнопка «Автоматизация» ставит встроенную
// автоматизацию Flow и сразу открывает меню шагов; «Из плагина Automations» —
// список включённых автоматизаций Automations. В меню шагов, кроме шагов Flow,
// есть «Добавить скрипт…»: выбранный файл хранится в автоматизации и становится
// шагом с именем файла. Шаги встроенной — теги, как
// исполнители у этапа навыка: плюс с меню, крест, перетаскивание. Шаги
// автоматизации Automations — теги только для чтения: они правятся там.
// Шаги встроенной сохраняются набором без имени кнопкой у строки; наборы —
// в меню кнопки «Автоматизация» строкой своих шагов, выбор ставит их в этап.
// Каталог Automations берётся с фронта относительным адресом входа
// (packages/automations-contract); нет плагина — в списке так и сказано.
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";

import { isStepId, STEP_IDS, type StepId } from "../packages/automation-steps/catalog";
import { automationsClient, type AutomationSummary, type CatalogResponse, type ClientResult } from "../packages/automations-contract/index";
import { Icon } from "../components/ui/icon";
import { builtinAutomationStage } from "../core/automation-run";
import { addScript, MAX_SCRIPT_CHARS, removeStep, scriptOf } from "../core/automation-scripts";
import { applySet, isSaved, removeSet, saveSet } from "../core/automation-sets";
import { moveItem } from "../core/reorder";
import { automationStage, automationStageId } from "../lib/stage-constants";
import { BUILTIN_AUTOMATION_ICON, EXTERNAL_AUTOMATION_ICON } from "./stage-icons";
import { cn } from "../lib/utils";
import type { AutomationSet, AutomationStep, BuiltinAutomation, WorkStage } from "../shared/contract";
import { useMessages } from "./locale-context";

const popover = "absolute left-0 top-full z-20 mt-1 max-h-80 w-max min-w-full max-w-[22rem] overflow-auto rounded-lg border border-border bg-card p-1 shadow-lg";
const popoverItem = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-state-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";
const addButton = "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-state-hover hover:text-foreground";
const tag = "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md bg-card text-xs";

type Loaded = { kind: "loading" } | { kind: "ready"; automations: AutomationSummary[] } | { kind: "missing" } | { kind: "failed" };

const loadedOf = (result: ClientResult<CatalogResponse>): Loaded =>
  result.ok
    ? { kind: "ready", automations: result.value.automations.filter((a) => a.enabled) }
    : result.reason === "not-installed"
      ? { kind: "missing" }
      : { kind: "failed" };

/** Закрывает всплывающее по нажатию вне корня. */
function useOutside(open: boolean, close: () => void) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, close]);
  return root;
}

type ScriptFile = { name: string; content: string };

/** Сохранённые наборы и их правка — от таблицы этапов: этот модуль не тянет SDK, его импортируют до загрузки приложения. */
export type AutomationSets = { sets: readonly AutomationSet[]; update: (change: (sets: readonly AutomationSet[]) => readonly AutomationSet[]) => void };

type SetsMenu = AutomationSets & { onSet: (set: AutomationSet) => void };

/** Подпись шага автоматизации: шаг Flow — по языку интерфейса, скрипт — именем файла. */
const useStepLabel = () => {
  const t = useMessages();
  return (automation: BuiltinAutomation, id: AutomationStep): string => (isStepId(id) ? t.steps[id] : (scriptOf(automation, id)?.name ?? id));
};

const useStepLabels = () => {
  const label = useStepLabel();
  return (automation: BuiltinAutomation): string[] => automation.steps.map((id) => label(automation, id));
};

/** Меню шагов Flow: сверху — сохранённые наборы, если меню их показывает; уже стоящие шаги недоступны; «Добавить скрипт…» открывает выбор файла. */
function StepsMenu({ taken, onPick, onScript, sets }: { taken: readonly AutomationStep[]; onPick: (id: StepId) => void; onScript: (file: ScriptFile) => void; sets?: SetsMenu }) {
  const t = useMessages();
  const labels = useStepLabels();
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
    <div role="menu" aria-label={t.settings.automationSteps} className={cn(popover, "min-w-[16rem]")}>
      {sets !== undefined && sets.sets.length > 0 && (
        <>
          <div className="px-2 pb-1 pt-1.5 text-[11px] text-muted-foreground">{t.settings.savedSets}</div>
          {sets.sets.map((set, i) => {
            const label = labels({ source: "flow", ...set }).join(" · ");
            return (
              <div key={`${i}-${label}`} className="flex items-center gap-0.5">
                <button type="button" role="menuitem" title={label} onClick={() => sets.onSet(set)} className={cn(popoverItem, "min-w-0 flex-1")}>
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
          <div role="separator" className="my-1 h-px bg-border" />
        </>
      )}
      {STEP_IDS.map((id) => (
        <button key={id} type="button" role="menuitem" aria-disabled={taken.includes(id)} disabled={taken.includes(id)} onClick={() => onPick(id)} className={popoverItem}>
          {t.steps[id]}
        </button>
      ))}
      <div role="separator" className="my-1 h-px bg-border" />
      <button type="button" role="menuitem" onClick={() => input.current?.click()} className={popoverItem}>
        <Icon name="Code" aria-hidden="true" className="size-3.5" />
        {t.settings.addScript}
      </button>
      {tooBig && <div className="px-2 py-1.5 text-xs text-destructive">{t.settings.scriptTooBig}</div>}
      <input ref={input} type="file" hidden onChange={(event) => void onFile(event)} />
    </div>
  );
}

const EMPTY: BuiltinAutomation = { source: "flow", steps: [] };

const builtinOf = (stage: WorkStage): BuiltinAutomation => (stage.automation !== undefined && "source" in stage.automation ? stage.automation : EMPTY);

const withAutomation = (stage: WorkStage, change: (automation: BuiltinAutomation) => BuiltinAutomation): WorkStage => ({ ...stage, automation: change(builtinOf(stage)) });

const withStep = (id: StepId) => (stage: WorkStage) => withAutomation(stage, (a) => ({ ...a, steps: [...a.steps, id] }));

/** Id скрипта — случайный: номер, освободившийся после удаления, повтор прогона принял бы за прежний скрипт. */
const withScript = (file: ScriptFile, id: string) => (stage: WorkStage) => withAutomation(stage, (a) => addScript(a, file, id));

/** «Автоматизация»: новая встроенная автоматизация в конец таблицы и меню её шагов под кнопкой. */
export function AddBuiltinAutomation({ stages, sets, onAdd, onChange }: { stages: readonly WorkStage[]; sets: AutomationSets; onAdd: (stage: WorkStage) => void; onChange: (id: string, change: (stage: WorkStage) => WorkStage) => void }) {
  const t = useMessages();
  const [added, setAdded] = useState<string | null>(null);
  const root = useOutside(added !== null, () => setAdded(null));
  const current = stages.find((s) => s.id === added);
  const labels = useStepLabels();
  const onSet = (set: AutomationSet) => {
    if (added === null) return;
    const automation = applySet(set, () => crypto.randomUUID());
    onChange(added, (stage) => ({ ...stage, name: labels(automation).join(", "), automation }));
    setAdded(null);
  };
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => {
          const stage = { ...builtinAutomationStage(stages.map((s) => s.id)), name: t.settings.automationStage };
          onAdd(stage);
          setAdded(stage.id);
        }}
        className={addButton}
      >
        <Icon name={BUILTIN_AUTOMATION_ICON} aria-hidden="true" className="size-3.5" />
        {t.settings.addBuiltinAutomation}
      </button>
      {added !== null && (
        <StepsMenu
          taken={current === undefined ? [] : builtinOf(current).steps}
          onPick={(id) => onChange(added, withStep(id))}
          onScript={(file) => onChange(added, withScript(file, crypto.randomUUID()))}
          // Набор ставится только в пустой этап: к уже выбранным шагам его не подмешать.
          {...(current === undefined || builtinOf(current).steps.length === 0 ? { sets: { ...sets, onSet } } : {})}
        />
      )}
    </div>
  );
}

/** «Из плагина Automations»: список включённых автоматизаций с поиском; этап получает снимок шагов. */
export function AddAutomation({ stages, onAdd }: { stages: readonly WorkStage[]; onAdd: (stage: WorkStage) => void }) {
  const t = useMessages();
  const [open, setOpen] = useState(false);
  const root = useOutside(open, () => setOpen(false));
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoaded({ kind: "loading" });
    void automationsClient("", fetch)
      .catalog()
      .then((result) => live && setLoaded(loadedOf(result)));
    return () => {
      live = false;
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const shown = loaded.kind === "ready" ? loaded.automations.filter((a) => q === "" || a.name.toLowerCase().includes(q)) : [];
  const taken = (automation: AutomationSummary) => stages.some((s) => s.id === automationStageId(automation.id));
  const note = (text: string) => <div className="px-2 py-1.5 text-xs text-muted-foreground">{text}</div>;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setQuery("");
          setOpen(!open);
        }}
        className={addButton}
      >
        <Icon name={EXTERNAL_AUTOMATION_ICON} aria-hidden="true" className="size-3.5" />
        {t.settings.addFromAutomations}
      </button>
      {open && (
        <div role="listbox" aria-label={t.settings.automations} className={cn(popover, "min-w-[18rem] max-w-[24rem]")}>
          <input
            autoFocus
            value={query}
            aria-label={t.settings.findAutomation}
            placeholder={t.settings.findAutomation}
            onChange={(e) => setQuery(e.target.value)}
            className="mb-1 h-7 w-full rounded-md border-0 bg-surface-recessed-solid px-2 text-[13px] outline-none placeholder:text-muted-foreground"
          />
          {loaded.kind === "loading" && note(t.settings.automationsLoading)}
          {loaded.kind === "missing" && note(t.settings.automationsMissing)}
          {loaded.kind === "failed" && note(t.settings.automationsFailed)}
          {loaded.kind === "ready" && shown.length === 0 && note(t.settings.noAutomations)}
          {shown.map((automation) => (
            <button
              key={automation.id}
              type="button"
              role="option"
              aria-selected={false}
              aria-disabled={taken(automation)}
              disabled={taken(automation)}
              title={automation.name}
              onClick={() => {
                const stage = automationStage(automation);
                onAdd(automation.steps === undefined ? stage : { ...stage, automation: { ...stage.automation, steps: [...automation.steps] } });
                setOpen(false);
              }}
              className={popoverItem}
            >
              <span className="min-w-0 truncate">{automation.name}</span>
              {automation.steps !== undefined && <span className="ml-auto shrink-0 pl-3 text-[11px] text-muted-foreground">{t.settings.stepCount(automation.steps.length)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Ячейка вида этапа-автоматизации: значок и чья она. */
export function AutomationKindCell({ stage }: { stage: WorkStage }) {
  const t = useMessages();
  const builtin = stage.automation !== undefined && "source" in stage.automation;
  return (
    <span role="cell" className="flex h-7 min-w-0 items-center px-2 text-xs text-muted-foreground">
      <span className="truncate">{builtin ? t.settings.automationStage : t.settings.automationsSource}</span>
    </span>
  );
}

/** Теги шагов этапа-автоматизации: у встроенной — правка, у автоматизации Automations — только чтение. */
export function AutomationStepTags({ stage, sets, onChange }: { stage: WorkStage; sets: AutomationSets; onChange: (change: (stage: WorkStage) => WorkStage) => void }) {
  const t = useMessages();
  const [open, setOpen] = useState(false);
  const root = useOutside(open, () => setOpen(false));
  const [dragged, setDragged] = useState<number | null>(null);
  const label = useStepLabel();
  const automation = stage.automation;
  if (automation === undefined) return null;

  if (!("source" in automation)) {
    return (
      <ul title={t.settings.stepsReadOnly} className="flex min-w-0 flex-wrap gap-1">
        {(automation.steps ?? []).map((label, i) => (
          <li key={`${i}-${label}`} className={cn(tag, "px-2")}>
            <span className="min-w-0 truncate">{label}</span>
          </li>
        ))}
      </ul>
    );
  }

  const steps = automation.steps;
  const labelOf = (id: AutomationStep) => label(automation, id);
  const saved = isSaved(sets.sets, automation);
  const drop = (event: DragEvent, target: number) => {
    event.preventDefault();
    if (dragged !== null) onChange((s) => withAutomation(s, (a) => ({ ...a, steps: moveItem(a.steps, dragged, target) })));
    setDragged(null);
  };
  return (
    <div ref={root} className="relative flex min-w-0 flex-wrap items-center gap-1">
      <button type="button" aria-label={t.settings.addStep} title={t.settings.addStep} aria-expanded={open} onClick={() => setOpen(!open)} className="flex size-7 shrink-0 items-center justify-center rounded-md bg-card text-muted-foreground hover:bg-state-hover hover:text-foreground">
        <Icon name="Plus" aria-hidden="true" className="size-3.5" />
      </button>
      {steps.length === 0 && <span className="px-1 text-xs text-muted-foreground">{t.settings.noSteps}</span>}
      <ul className="contents">
        {steps.map((id, i) => (
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
            <button type="button" aria-label={t.settings.removeStep(labelOf(id))} onClick={() => onChange((s) => withAutomation(s, (a) => removeStep(a, id)))} className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground">
              <Icon name="X" aria-hidden="true" className="size-3" />
            </button>
          </li>
        ))}
      </ul>
      {steps.length > 0 && (
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
      {open && (
        <StepsMenu
          taken={steps}
          onPick={(id) => {
            onChange(withStep(id));
            setOpen(false);
          }}
          onScript={(file) => {
            onChange(withScript(file, crypto.randomUUID()));
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

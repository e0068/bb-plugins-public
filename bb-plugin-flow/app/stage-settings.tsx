// Таблица этапов выбранного flow и ширина кнопки этапа на странице Flow.
// Строка этапа — ручка перетаскивания поверх номера и иконка вида за ним, навык со списком навыков и
// кнопками «открыть файл навыка» и «показать в файловой системе»,
// название, исполнители тегами с плюсом в начале и крест. Строка встроенного
// вида — навык (пустое поле — навык вида), название, имя вида с охватом. Внизу — плюс и пять кнопок добавления.
// Каждая правка сохраняется: переключатели — сразу, название — через 400 мс после набора, навык и ширина — при уходе фокуса.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";

import { dropIndex, moveItem } from "../core/reorder";
import { setFlowStages } from "../core/flows";
import { stageLabel } from "../core/stages";
import { FieldOverlay, overlayItem, useFieldOverlay } from "../components/ui/field-overlay";
import { Icon } from "../components/ui/icon";
import { Input } from "../components/ui/input";
import { BUILTIN_KINDS, BUILTIN_SKILLS, builtinStage, stageKindOf, stageSkillOf, STAGE_BUTTON_WIDTH as WIDTH, type BuiltinKind } from "../lib/stage-constants";
import { cn } from "../lib/utils";
import type { flowSettingsRpcContract, StageCatalog, StageExecutor, WorkStage } from "../shared/contract";
import { AddAction, AddAutomation, AddBuiltinAutomation, type AutomationSets, AutomationKindCell, AutomationStepTags } from "./automation-stage";
import { useMessages } from "./locale-context";
import { ExecutorMark } from "./provider-logos";
import { KIND_ICONS, SKILL_ICON, stageIcon } from "./stage-icons";
import { commitFlowSettings, updateFlowSettings, useAutomationSets, useFlowSettings } from "./stage-settings-store";

const field = "h-7 min-h-7 w-full min-w-0 rounded-md border-0 bg-card px-2 py-0 text-[13px] shadow-none focus-visible:ring-1";
const square = "flex size-7 shrink-0 items-center justify-center rounded-md";

const newStageId = (): string => `stage-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Flow, чью таблицу правит страница: строки не знают о коллекции. */
const FlowIdContext = createContext("");

/** Правка этапов открытого flow. */
function useStagesUpdate() {
  const flowId = useContext(FlowIdContext);
  return (change: (stages: WorkStage[]) => WorkStage[], save = true) => updateFlowSettings((s) => setFlowStages(s, flowId, change), save);
}

/** Наборы автоматизаций коллекции и их правка; правка без изменений ничего не пишет. */
function useSets(): AutomationSets {
  const sets = useAutomationSets();
  return {
    sets,
    update: (change) =>
      updateFlowSettings((s) => {
        const current = s.automationSets ?? [];
        const next = change(current);
        return next === current ? s : { ...s, automationSets: [...next] };
      }),
  };
}

function useSetStage() {
  const update = useStagesUpdate();
  return (id: string, change: (stage: WorkStage) => WorkStage, save = true) => update((stages) => stages.map((stage) => (stage.id === id ? change(stage) : stage)), save);
}

function ExecutorIcon({ executor }: { executor: StageExecutor }) {
  return <ExecutorMark executor={executor} className="size-3.5 shrink-0 text-muted-foreground" />;
}

function SkillOptions({ catalog, query, current, onPick }: { catalog: StageCatalog; query: string; current: string | null; onPick: (name: string) => void }) {
  const t = useMessages();
  const q = query.trim().toLowerCase();
  const found = catalog.skills.filter((s) => q === "" || s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q));
  return found.length === 0 ? (
    <div className="px-2 py-1.5 text-xs text-muted-foreground">{t.settings.skillNotFound}</div>
  ) : (
    <>
      {found.map((skill) => (
        <button
          key={skill.name}
          type="button"
          role="option"
          aria-selected={skill.name === current}
          onClick={() => onPick(skill.name)}
          className={cn(overlayItem, skill.name === current && "bg-state-active")}
        >
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="font-mono text-xs">{skill.name}</span>
            {skill.description !== undefined && <span className="line-clamp-1 text-[11px] text-muted-foreground">{skill.description}</span>}
          </span>
        </button>
      ))}
    </>
  );
}

/** Две кнопки справа в поле навыка: файл навыка просмотрщиком bb и показ файла в файловой системе. Путь находит сервер по имени навыка. */
function SkillFileButtons({ skill }: { skill: string }) {
  const t = useMessages();
  const rpc = useRpc<typeof flowSettingsRpcContract>();
  const navigate = useBbNavigate();
  const [missing, setMissing] = useState(false);
  const failed = () => setMissing(true);
  useEffect(() => setMissing(false), [skill]);
  if (skill === "") return null;
  const open = () =>
    void rpc.call("getSkillFile", { name: skill }).then((file) => {
      if (file === null) failed();
      else navigate.experimental_openFilePreview({ target: { kind: "host", hostId: file.hostId, path: file.path }, location: null });
    }, failed);
  const reveal = () => void rpc.call("revealSkill", { name: skill }).then((result) => !result.revealed && failed(), failed);
  const button = "flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground";
  return (
    <>
      <span className="absolute right-1 top-1 flex items-center gap-0.5">
        <button type="button" aria-label={t.settings.openSkill(skill)} title={t.settings.openSkill(skill)} onClick={open} className={button}>
          <Icon name="PanelRight" aria-hidden="true" className="size-3.5" />
        </button>
        <button type="button" aria-label={t.settings.revealSkill(skill)} title={t.settings.revealSkill(skill)} onClick={reveal} className={button}>
          <Icon name="Folder" aria-hidden="true" className="size-3.5" />
        </button>
      </span>
      {missing && (
        <span role="status" className="mt-1 block text-[11px] text-muted-foreground">
          {t.settings.skillFileMissing}
        </span>
      )}
    </>
  );
}

function SkillField({ stage, index, catalog }: { stage: WorkStage; index: number; catalog: StageCatalog }) {
  const t = useMessages();
  const setStage = useSetStage();
  const [query, setQuery] = useState<string | null>(null);
  const open = query !== null;
  const close = () => setQuery(null);
  const { root, compact } = useFieldOverlay(open, close);
  const kind = stageKindOf(stage);
  const current = stageSkillOf(stage);
  // Встроенный этап хранит навык вида пустым полем и не берёт имя навыка в название.
  const pick = (skill: string) => {
    setStage(stage.id, (s) =>
      kind === "skill" ? { ...s, skill, name: s.name.trim() === "" || s.name === s.skill ? skill : s.name } : { ...s, skill: kind !== "action" && skill === BUILTIN_SKILLS[kind] ? "" : skill },
    );
    close();
  };
  const listId = `stage-skills-${stage.id}`;
  return (
    <div ref={root} className="relative min-w-0">
      {compact ? (
        // На телефоне поле — кнопка: тап поднимает штору, а набор живёт в ней.
        // Поле, открывающее список фокусом, выехавшей клавиатурой закрыло бы
        // список собой в тот же момент, когда его открыло.
        <button
          type="button"
          role="combobox"
          aria-label={t.settings.stageSkill(index + 1)}
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setQuery("")}
          className={cn(field, "flex items-center pr-14 text-left font-mono text-xs")}
        >
          <span className="min-w-0 truncate">{current}</span>
        </button>
      ) : (
        <Input
          role="combobox"
          aria-label={t.settings.stageSkill(index + 1)}
          aria-expanded={open}
          aria-controls={listId}
          value={query ?? current}
          placeholder={current}
          onFocus={() => setQuery("")}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={(e) => {
            // Уход фокуса в список — это выбор, а не набор своего навыка.
            if (root.current?.contains(e.relatedTarget as Node | null)) return;
            if (query !== null && query.trim() !== "") pick(query.trim());
            else close();
          }}
          className={cn(field, "pr-14 font-mono text-xs")}
        />
      )}
      <SkillFileButtons skill={current} />
      <FieldOverlay open={open} onClose={close} role="listbox" label={t.settings.skills} id={listId}>
        {compact && (
          <Input
            aria-label={t.settings.findSkill}
            value={query ?? ""}
            placeholder={current}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // В шторе фокус не уходит наружу, поэтому свой навык подтверждает Enter, а не уход фокуса.
              if (e.key === "Enter" && (query ?? "").trim() !== "") pick((query ?? "").trim());
            }}
            className={cn(field, "mb-1 font-mono text-xs")}
          />
        )}
        <SkillOptions catalog={catalog} query={query ?? ""} current={current} onPick={pick} />
      </FieldOverlay>
    </div>
  );
}

function ExecutorTags({ stage, catalog }: { stage: WorkStage; catalog: StageCatalog }) {
  const t = useMessages();
  const setStage = useSetStage();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const { root } = useFieldOverlay(open, close);
  const toggle = (executor: StageExecutor) =>
    setStage(stage.id, (s) => ({ ...s, executors: s.executors.some((e) => e.id === executor.id) ? s.executors.filter((e) => e.id !== executor.id) : [...s.executors, executor] }));
  const group = (title: string, kind: StageExecutor["kind"]) => {
    const items = catalog.executors.filter((e) => e.kind === kind);
    return items.length === 0 ? null : (
      <div role="group" aria-label={title}>
        <div className="px-2 pb-0.5 pt-1.5 text-[11px] text-muted-foreground">{title}</div>
        {items.map((executor) => {
          const on = stage.executors.some((e) => e.id === executor.id);
          return (
            <button key={executor.id} type="button" role="menuitemcheckbox" aria-checked={on} onClick={() => toggle(executor)} className={overlayItem}>
              <ExecutorIcon executor={executor} />
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span>{executor.name}</span>
                <span className="line-clamp-1 text-[11px] text-muted-foreground">{executor.model ?? executor.description ?? ""}</span>
              </span>
              <span aria-hidden="true" className={cn("flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-border", on && "border-foreground bg-foreground text-background")}>
                {on && <Icon name="Check" className="size-3" />}
              </span>
            </button>
          );
        })}
      </div>
    );
  };
  return (
    <div ref={root} className="relative flex min-w-0 flex-wrap gap-1">
      <button type="button" aria-label={t.settings.addExecutor} title={t.settings.addExecutorTitle} aria-expanded={open} onClick={() => setOpen(!open)} className={cn(square, "bg-card text-muted-foreground hover:bg-state-hover hover:text-foreground")}>
        <Icon name="Plus" aria-hidden="true" className="size-3.5" />
      </button>
      {stage.executors.map((executor) => (
        <span key={executor.id} className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md bg-card pl-2 pr-0.5 text-xs">
          <ExecutorIcon executor={executor} />
          <span className="min-w-0 truncate">{executor.name}</span>
          {executor.model !== undefined && <span className="shrink-0 text-[11px] text-muted-foreground">{executor.model}</span>}
          <button type="button" aria-label={t.settings.remove(executor.name)} onClick={() => toggle(executor)} className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground">
            <Icon name="X" aria-hidden="true" className="size-3" />
          </button>
        </span>
      ))}
      <FieldOverlay open={open} onClose={close} role="menu" label={t.settings.executorsMenu}>
        {catalog.executors.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">{t.settings.noExecutors}</div>
        ) : (
          <>
            {group(t.settings.agents, "agent")}
            {group(t.settings.workflows, "workflow")}
          </>
        )}
      </FieldOverlay>
    </div>
  );
}

/** Сетка строки: номер с ручкой и иконка вида, средние ячейки одной группой, крест. */
const rowGrid = "grid grid-cols-[46px_minmax(0,1fr)_28px] items-start gap-2";

/**
 * Средние ячейки — навык или вид, название, исполнение. Стоят в ряд, пока каждой хватает её основы, и переносятся
 * сами, когда перестаёт хватать: сначала исполнение уходит под поля, потом название под навык. Перенос считает
 * flex-wrap по основе ячейки, а не ширина страницы, поэтому поля не встают в столбик раньше времени.
 */
const cellGroup = "flex min-w-0 flex-wrap items-start gap-2";

/** Основа ячейки — 200px: ниже неё поля уже не читаются, и ряд переносится. */
const cell = "min-w-0 grow basis-[200px]";

/** Исполнение тянется шире полей — там теги, а не одна строка текста. */
const cellWide = "min-w-0 grow-[2.2] basis-[200px]";

/** Ячейки строки между номером и крестом. Группа в тексте роли не имеет: ячейки остаются ячейками строки. */
function StageCells({ children }: { children: ReactNode }) {
  return (
    <span role="none" className={cellGroup}>
      {children}
    </span>
  );
}

/** Пауза набора названия перед сохранением. */
const NAME_SAVE_DELAY_MS = 400;

/** Название этапа сохраняется через паузу набора; недосохранённое уходит при размонтировании строки. */
function useStageName(stage: WorkStage) {
  const setStage = useSetStage();
  const [name, setName] = useState(stage.name);
  const pending = useRef<string | null>(null);
  useEffect(() => {
    if (pending.current === null) setName(stage.name);
  }, [stage.name]);
  const flush = useRef(() => {});
  flush.current = () => {
    const next = pending.current?.trim() ?? "";
    pending.current = null;
    if (next !== "" && next !== stage.name) setStage(stage.id, (s) => ({ ...s, name: next }));
  };
  useEffect(() => {
    if (pending.current === null) return;
    const timer = setTimeout(() => flush.current(), NAME_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [name]);
  useEffect(() => () => flush.current(), []);
  const change = (text: string) => {
    pending.current = text;
    setName(text);
  };
  return { name, change, flush: () => flush.current() };
}

/** Номер этапа, под наведением — ручка перетаскивания, и сразу за ним иконка вида этапа. */
function StageLead({ stage, index, dragging, onGrab }: { stage: WorkStage; index: number; dragging: boolean; onGrab: () => void }) {
  const t = useMessages();
  return (
    <span role="cell" className="flex h-7 items-center gap-1 text-muted-foreground">
      <span className="relative flex size-7 shrink-0 items-center justify-center">
        <span className="text-xs tabular-nums group-hover:opacity-0">{index + 1}</span>
        <button
          type="button"
          aria-label={t.settings.drag(stageLabel(stage, t.stages))}
          onPointerDown={(e) => {
            e.preventDefault();
            onGrab();
          }}
          className={cn(square, "absolute inset-0 cursor-grab touch-none text-muted-foreground opacity-0 hover:bg-state-hover hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100", dragging && "cursor-grabbing opacity-100")}
        >
          <Icon name="DragDropVertical" aria-hidden="true" className="size-3.5" />
        </button>
      </span>
      <Icon name={stageIcon(stage)} aria-hidden="true" className="size-3.5 shrink-0" />
    </span>
  );
}

function DeleteStage({ stage }: { stage: WorkStage }) {
  const t = useMessages();
  const update = useStagesUpdate();
  return (
    <span role="cell" className="col-start-3 row-start-1 @[44rem]:col-start-auto @[44rem]:row-start-auto">
      <button
        type="button"
        aria-label={t.settings.deleteStage(stageLabel(stage, t.stages))}
        onClick={() => update((stages) => stages.filter((x) => x.id !== stage.id))}
        className={cn(square, "text-muted-foreground hover:bg-state-hover hover:text-foreground")}
      >
        <Icon name="X" aria-hidden="true" className="size-3.5" />
      </button>
    </span>
  );
}

type RowProps = { stage: WorkStage; index: number; stages: readonly WorkStage[]; catalog: StageCatalog; dragging: boolean; onGrab: () => void };

/** Номера этапов, которые охватывает встроенный этап: Выбор — до следующего Выбора, Демонстрация — с прошлой Демонстрации. */
const scopeOf = (stages: readonly WorkStage[], index: number): [number, number] | null => {
  const kinds = stages.map(stageKindOf);
  const own = kinds[index];
  const bound = (from: number, step: 1 | -1): number => {
    let i = from;
    while (i >= 0 && i < kinds.length && kinds[i] !== own) i += step;
    return i;
  };
  const [first, last] = own === "select" ? [index + 1, bound(index + 1, 1) - 1] : [bound(index - 1, -1) + 1, index - 1];
  return first > last ? null : [first + 1, last + 1];
};

/** Строка встроенного вида: навык вида полем, название полем, имя вида и охват; исполнителей у него нет. */
function BuiltinStageRow({ stage, index, stages, catalog, dragging, onGrab }: RowProps) {
  const t = useMessages();
  const kind = stageKindOf(stage) as BuiltinKind;
  const { name, change, flush } = useStageName(stage);
  const scope = kind === "select" || kind === "demo" ? scopeOf(stages, index) : null;
  const scopeText = kind === "select" || kind === "demo" ? (scope === null ? t.settings.scopeNone : kind === "select" ? t.settings.scopeSelect(...scope) : t.settings.scopeDemo(...scope)) : "";
  return (
    <div role="row" aria-label={t.settings.stage(index + 1)} data-stage-row={stage.id} className={cn("group", rowGrid, "bg-surface-recessed-solid py-2 pl-1 pr-2", dragging && "bg-state-active")}>
      <StageLead stage={stage} index={index} dragging={dragging} onGrab={onGrab} />
      <StageCells>
        <span role="cell" className={cell}>
          <SkillField stage={stage} index={index} catalog={catalog} />
        </span>
        <span role="cell" className={cell}>
          <Input aria-label={t.settings.stageName(index + 1)} placeholder={t.settings.namePlaceholder} value={name} onChange={(e) => change(e.target.value)} onBlur={flush} className={field} />
        </span>
        <span role="cell" className={cn(cellWide, "flex h-7 items-center gap-1.5 text-xs text-muted-foreground")}>
          <span className="shrink-0">{t.stages[kind]}</span>
          {scopeText !== "" && <span className="truncate">{scopeText}</span>}
        </span>
      </StageCells>
      <DeleteStage stage={stage} />
    </div>
  );
}

/**
 * Этап-автоматизация: вместо навыка — чья автоматизация, вместо исполнителей — шаги тегами. Встроенная правит название и шаги;
 * у автоматизации Automations название и шаги — снимок, правятся в том плагине. Исполняет этап Flow (server/automation-runner.ts).
 */
function AutomationStageRow({ stage, index, stages, dragging, onGrab }: RowProps) {
  const t = useMessages();
  const setStage = useSetStage();
  const sets = useSets();
  const { name, change, flush } = useStageName(stage);
  const builtin = stage.automation !== undefined && "source" in stage.automation;
  return (
    <div role="row" aria-label={t.settings.stage(index + 1)} data-stage-row={stage.id} className={cn("group", rowGrid, "bg-surface-recessed-solid py-2 pl-1 pr-2", dragging && "bg-state-active")}>
      <StageLead stage={stage} index={index} dragging={dragging} onGrab={onGrab} />
      <StageCells>
        <AutomationKindCell stage={stage} className={cell} />
        <span role="cell" className={cell}>
          {builtin ? (
            <Input aria-label={t.settings.stageName(index + 1)} placeholder={t.settings.namePlaceholder} value={name} onChange={(e) => change(e.target.value)} onBlur={flush} className={field} />
          ) : (
            <span title={stage.name} className="flex h-7 min-w-0 items-center truncate px-2 text-[13px]">
              {stage.name}
            </span>
          )}
        </span>
        <span role="cell" className={cellWide}>
          <AutomationStepTags stage={stage} stages={stages} sets={sets} onChange={(change) => setStage(stage.id, change)} />
        </span>
      </StageCells>
      <DeleteStage stage={stage} />
    </div>
  );
}

function StageRow(props: RowProps) {
  const { stage, index, catalog, dragging, onGrab } = props;
  const t = useMessages();
  const { name, change, flush } = useStageName(stage);
  if (stage.automation !== undefined) return <AutomationStageRow {...props} />;
  if (stageKindOf(stage) !== "skill") return <BuiltinStageRow {...props} />;
  return (
    <div role="row" aria-label={t.settings.stage(index + 1)} data-stage-row={stage.id} className={cn("group", rowGrid, "bg-surface-recessed-solid py-2 pl-1 pr-2", dragging && "bg-state-active")}>
      <StageLead stage={stage} index={index} dragging={dragging} onGrab={onGrab} />
      <StageCells>
        <span role="cell" className={cell}>
          <SkillField stage={stage} index={index} catalog={catalog} />
        </span>
        <span role="cell" className={cell}>
          <Input
            aria-label={t.settings.stageName(index + 1)}
            placeholder={t.settings.namePlaceholder}
            value={name}
            onChange={(e) => change(e.target.value)}
            onBlur={flush}
            className={field}
          />
        </span>
        <span role="cell" className={cellWide}>
          <ExecutorTags stage={stage} catalog={catalog} />
        </span>
      </StageCells>
      <DeleteStage stage={stage} />
    </div>
  );
}

const addButton = "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-state-hover hover:text-foreground";

/** Плюс под колонкой номеров и пять кнопок: Навык со списком навыков и по кнопке на встроенный вид — каждая дописывает этап в конец. */
function AddStage({ catalog, stages }: { catalog: StageCatalog; stages: readonly WorkStage[] }) {
  const t = useMessages();
  const update = useStagesUpdate();
  const sets = useSets();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const { root } = useFieldOverlay(open, close);
  const add = (skill: string) => {
    update((current) => [...current, { id: newStageId(), kind: "skill", skill, name: skill, executors: [] }]);
    setOpen(false);
  };
  const addBuiltin = (kind: BuiltinKind) => update((current) => [...current, builtinStage(kind, current.map((s) => s.id))]);
  return (
    <div ref={root} className="relative flex flex-wrap items-center gap-0.5 bg-surface-recessed-solid py-2 pl-1 pr-2">
      <span aria-hidden="true" className="flex size-7 items-center justify-center text-muted-foreground">
        <Icon name="Plus" className="size-3.5" />
      </span>
      <button type="button" aria-label={t.settings.addStage(t.settings.skill)} aria-expanded={open} onClick={() => setOpen(!open)} className={cn(addButton, "text-foreground")}>
        <Icon name={SKILL_ICON} aria-hidden="true" className="size-3.5" />
        {t.settings.skill}
      </button>
      <span aria-hidden="true" className="mx-1.5 hidden h-4 w-px bg-border @[44rem]:block" />
      {BUILTIN_KINDS.map((kind) => (
        <button key={kind} type="button" aria-label={t.settings.addStage(t.stages[kind])} onClick={() => addBuiltin(kind)} className={addButton}>
          <Icon name={KIND_ICONS[kind]} aria-hidden="true" className="size-3.5" />
          {t.stages[kind]}
        </button>
      ))}
      <span aria-hidden="true" className="mx-1.5 hidden h-4 w-px bg-border @[44rem]:block" />
      <AddBuiltinAutomation
        stages={stages}
        sets={sets}
        onAdd={(stage) => update((current) => [...current, stage])}
        onChange={(id, change) => update((current) => current.map((stage) => (stage.id === id ? change(stage) : stage)))}
      />
      <AddAutomation stages={stages} onAdd={(stage) => update((current) => [...current, stage])} />
      <AddAction
        stages={stages}
        onAdd={(stage) => update((current) => [...current, stage])}
        onChange={(id, change) => update((current) => current.map((stage) => (stage.id === id ? change(stage) : stage)))}
      />
      <FieldOverlay open={open} onClose={close} role="listbox" label={t.settings.skills} className="left-9 min-w-[18rem]">
        <SkillOptions catalog={catalog} query="" current={null} onPick={add} />
      </FieldOverlay>
    </div>
  );
}

function Loading({ failed, children }: { failed: boolean; children: ReactNode }) {
  const t = useMessages();
  return failed ? <div className="text-xs text-destructive">{t.settings.loadFailed}</div> : <>{children}</>;
}

/** Перетаскивание за ручку: строка переезжает на лету, сохраняется порядок на отпускании. */
function useRowDrag(table: React.RefObject<HTMLDivElement | null>) {
  const update = useStagesUpdate();
  const [dragged, setDragged] = useState<string | null>(null);
  useEffect(() => {
    if (dragged === null) return;
    const onMove = (event: PointerEvent) => {
      const rows = [...(table.current?.querySelectorAll<HTMLElement>("[data-stage-row]") ?? [])];
      const from = rows.findIndex((row) => row.dataset.stageRow === dragged);
      const middles = rows.map((row) => {
        const box = row.getBoundingClientRect();
        return box.top + box.height / 2;
      });
      const to = dropIndex(middles, event.clientY);
      if (from !== -1 && to !== from) update((stages) => moveItem(stages, from, to), false);
    };
    const onUp = () => {
      setDragged(null);
      commitFlowSettings();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- правка берёт flow из контекста, подписка — на начало перетаскивания
  }, [dragged, table]);
  return { dragged, grab: setDragged };
}

/** Таблица этапов flow `flowId`. Хранилище коллекции держит страница. */
export function WorkStagesTable({ flowId }: { flowId: string }) {
  return (
    <FlowIdContext.Provider value={flowId}>
      <WorkStages flowId={flowId} />
    </FlowIdContext.Provider>
  );
}

function WorkStages({ flowId }: { flowId: string }) {
  const t = useMessages();
  const { settings, catalog, failed, saveError, saveProblem } = useFlowSettings();
  const table = useRef<HTMLDivElement>(null);
  const { dragged, grab } = useRowDrag(table);
  const stages = settings?.flows.find((f) => f.id === flowId)?.stages ?? [];
  return (
    <Loading failed={failed}>
      {(saveProblem !== null || saveError !== null) && (
        <div role="alert" className="mb-1 text-xs text-destructive">
          {saveProblem === null ? saveError : t.settings.stepOrderRefused(t.steps[saveProblem.step], saveProblem.stageName, t.steps["git.create-pr"])}
        </div>
      )}
      <div ref={table} role="table" aria-label={t.settings.table} aria-busy={settings === null || undefined} className="@container flex flex-col gap-px overflow-visible [&>*:first-child]:rounded-t-lg [&>*:last-child]:rounded-b-lg">
        <div role="row" className={cn(rowGrid, "hidden bg-surface-recessed-solid py-1 pl-1 pr-2 text-[11px] text-muted-foreground @[46rem]:grid")}>
          <span role="columnheader" className="text-center">
            №
          </span>
          <StageCells>
            <span role="columnheader" className={cell}>
              {t.settings.colSkill}
            </span>
            <span role="columnheader" className={cell}>
              {t.settings.colName}
            </span>
            <span role="columnheader" className={cellWide}>
              {t.settings.colExecution}
            </span>
          </StageCells>
          <span role="columnheader">
            <span className="sr-only">{t.settings.colDelete}</span>
          </span>
        </div>
        {stages.map((stage, index) => (
          <StageRow key={stage.id} stage={stage} index={index} stages={stages} catalog={catalog} dragging={dragged === stage.id} onGrab={() => grab(stage.id)} />
        ))}
        {settings !== null && <AddStage catalog={catalog} stages={stages} />}
      </div>
    </Loading>
  );
}

/** Минимальная ширина кнопки этапа в брифе — общая на все flow. */
export function StageButtonWidth() {
  const t = useMessages();
  const { settings, failed } = useFlowSettings();
  const [width, setWidth] = useState<string | null>(null);
  const shown = width ?? String(settings?.minButtonWidth ?? "");
  const save = () => {
    const value = Math.round(Number(shown));
    setWidth(null);
    if (settings === null || !Number.isFinite(value)) return;
    const clamped = Math.min(WIDTH.max, Math.max(WIDTH.min, value));
    if (clamped !== settings.minButtonWidth) updateFlowSettings((s) => ({ ...s, minButtonWidth: clamped }));
  };
  return (
    <Loading failed={failed}>
      <label className="flex min-h-11 items-center gap-3 rounded-lg bg-surface-recessed-solid px-3 py-2 text-[13px]">
        <span className="flex-1">{t.settings.minWidth}</span>
        <Input
          type="number"
          min={WIDTH.min}
          max={WIDTH.max}
          step={10}
          aria-label={t.settings.minWidthPx}
          disabled={settings === null}
          value={shown}
          onChange={(e) => setWidth(e.target.value)}
          onBlur={save}
          className={cn(field, "w-20 text-right font-mono text-xs")}
        />
        <span className="text-muted-foreground">px</span>
      </label>
    </Loading>
  );
}

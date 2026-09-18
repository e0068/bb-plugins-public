// Коллекция flow: чистые правки, этапы по умолчанию и перенос прежнего
// единственного списка этапов. Нужна серверу и странице Flow, поэтому из
// контракта берутся только типы.
import { builtinStage, STAGE_BUTTON_WIDTH, stageKindOf, type BuiltinKind } from "../lib/stage-constants";
import type { Flow, FlowSettings, StageSettings, WorkStage } from "../shared/contract";

const skill = (id: string, skillName: string, name: string): WorkStage => ({ id, kind: "skill", skill: skillName, name, executors: [] });

/** Встроенный этап вида в ряду уже собранных — с id, свободным среди них. */
const builtin = (kind: BuiltinKind, before: readonly WorkStage[]): WorkStage => builtinStage(kind, before.map((s) => s.id));

const withBuiltins = (plan: ReadonlyArray<WorkStage | BuiltinKind>): WorkStage[] =>
  plan.reduce<WorkStage[]>((stages, item) => [...stages, typeof item === "string" ? builtin(item, stages) : item], []);

/** Этапы нового flow: Вопросы, Критерии и Выбор этапов, работа с Демонстрацией после прототипа и в конце. Названия — данные владельца; начальные — английские, языка сервер не знает. */
export const DEFAULT_STAGES: readonly WorkStage[] = withBuiltins([
  "questions",
  "criteria",
  "select",
  skill("task", "task-flow", "Task"),
  skill("prototype", "prototype", "HTML prototype"),
  "demo",
  skill("spec", "spec", "Spec"),
  skill("plan", "plan", "Plan"),
  skill("implement", "code-standards-fp", "Implementation"),
  skill("review", "code-review", "Review"),
  skill("testing", "testing-tdd", "Testing"),
  "demo",
]);

const DEFAULT_FLOW_ID = "default";
const DEFAULT_FLOW_NAME = "Default";

export const newFlow = (id: string, name: string): Flow => ({ id, name, stages: [...DEFAULT_STAGES] });

/** Этап с видом и без флага review. */
const withKind = ({ review: _review, ...stage }: WorkStage): WorkStage => ({ ...stage, kind: stageKindOf(stage) });

/**
 * Этапы flow до видов — в этапы с видами. Выбор этапов встаёт за ведущими Вопросами и Критериями, если его нет;
 * за этапом с Review by User — Демонстрация, если следующий этап не она: остановка на показ сохраняется этапом.
 */
const migrateStages = (stages: readonly WorkStage[]): WorkStage[] => {
  const kinded = stages.flatMap((stage, i): Array<WorkStage | BuiltinKind> => {
    const next = stages[i + 1];
    const demoAfter = stage.review === true && (next === undefined || stageKindOf(next) !== "demo");
    return demoAfter ? [withKind(stage), "demo"] : [withKind(stage)];
  });
  const leading = kinded.findIndex((item) => typeof item === "string" || (item.kind !== "questions" && item.kind !== "criteria"));
  const at = leading === -1 ? kinded.length : leading;
  const hasSelect = kinded.some((item) => typeof item !== "string" && item.kind === "select");
  const plan = hasSelect ? kinded : [...kinded.slice(0, at), "select" as const, ...kinded.slice(at)];
  // Id встроенных этапов раздаются после этапов из записи: свободный id не должен совпасть ни с одним записанным.
  const taken = stages.map((s) => s.id);
  return plan.reduce<WorkStage[]>((out, item) => [...out, typeof item === "string" ? builtinStage(item, [...taken, ...out.map((s) => s.id)]) : item], []);
};

/** Коллекция до видов этапов — в версию 2; версия 2 возвращается как есть, поэтому перенос случается один раз. */
export const migrateFlows = (settings: FlowSettings): FlowSettings =>
  settings.version === 2 ? settings : { ...settings, version: 2, flows: settings.flows.map((flow) => ({ ...flow, stages: migrateStages(flow.stages) })) };

/** Прежний единственный список этапов становится flow Default, перенесённым на виды; без записи — этапы по умолчанию. */
export const fromLegacy = (legacy: StageSettings | undefined): FlowSettings =>
  legacy === undefined
    ? { flows: [newFlow(DEFAULT_FLOW_ID, DEFAULT_FLOW_NAME)], minButtonWidth: STAGE_BUTTON_WIDTH.initial, version: 2 }
    : migrateFlows({ flows: [{ id: DEFAULT_FLOW_ID, name: DEFAULT_FLOW_NAME, stages: [...withBuiltins(["questions", "criteria"]).filter((b) => !legacy.stages.some((s) => stageKindOf(s) === b.kind)), ...legacy.stages] }], minButtonWidth: legacy.minButtonWidth });

const mapFlow = (settings: FlowSettings, id: string, change: (flow: Flow) => Flow): FlowSettings => ({
  ...settings,
  flows: settings.flows.map((flow) => (flow.id === id ? change(flow) : flow)),
});

export const addFlow = (settings: FlowSettings, flow: Flow): FlowSettings => ({ ...settings, flows: [...settings.flows, flow] });

/** Пустое имя flow не бывает: такая правка возвращает коллекцию как была. */
export const renameFlow = (settings: FlowSettings, id: string, name: string): FlowSettings => {
  const trimmed = name.trim();
  return trimmed === "" ? settings : mapFlow(settings, id, (flow) => ({ ...flow, name: trimmed }));
};

/** Последний flow не удаляется: треду нужен хоть какой-то. */
export const removeFlow = (settings: FlowSettings, id: string): FlowSettings =>
  settings.flows.length <= 1 ? settings : { ...settings, flows: settings.flows.filter((flow) => flow.id !== id) };

/**
 * Flow с тем же id заменяется, новый добавляется; `position` ставит flow на это место, за концом списка — в конец.
 * Без `position` замена остаётся на своём месте, новый встаёт в конец. Остальные flow не меняются.
 */
export const putFlow = (settings: FlowSettings, flow: Flow, position?: number): FlowSettings => {
  const at = settings.flows.findIndex((f) => f.id === flow.id);
  if (position === undefined && at !== -1) return mapFlow(settings, flow.id, () => flow);
  const others = settings.flows.filter((f) => f.id !== flow.id);
  const place = Math.min(position ?? others.length, others.length);
  return { ...settings, flows: [...others.slice(0, place), flow, ...others.slice(place)] };
};

export const setFlowStages =(settings: FlowSettings, id: string, change: (stages: WorkStage[]) => WorkStage[]): FlowSettings =>
  mapFlow(settings, id, (flow) => ({ ...flow, stages: change(flow.stages) }));

/** Flow по умолчанию — первый в списке. */
export const defaultFlow = (settings: FlowSettings): Flow => settings.flows[0]!;

/** Flow по id; неизвестный, удалённый или не заданный id — flow по умолчанию. Так же выбирается flow треда. */
export const flowById = (settings: FlowSettings, id: string | undefined): Flow => settings.flows.find((flow) => flow.id === id) ?? defaultFlow(settings);

/** Этапы flow с общей шириной кнопки — форма, которую проверяет бриф и видят инструкции. */
export const stageSettingsOf = (settings: FlowSettings, flow: Flow): StageSettings => ({ stages: flow.stages, minButtonWidth: settings.minButtonWidth });

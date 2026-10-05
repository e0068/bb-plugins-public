// Коллекция flow: чистые правки, этапы по умолчанию и перенос прежнего
// единственного списка этапов. Нужна серверу и странице Flow, поэтому из
// контракта берутся только типы.
import { builtinStage, freeId, STAGE_BUTTON_WIDTH, stageKindOf, type BuiltinKind } from "../lib/stage-constants";
import type { Flow, FlowSettings, StageSettings, WorkStage } from "../shared/contract";

/** Встроенный этап вида в ряду уже собранных — с id, свободным среди них. */
const builtin = (kind: BuiltinKind, before: readonly WorkStage[]): WorkStage => builtinStage(kind, before.map((s) => s.id));

const withBuiltins = (plan: ReadonlyArray<WorkStage | BuiltinKind>): WorkStage[] =>
  plan.reduce<WorkStage[]>((stages, item) => [...stages, typeof item === "string" ? builtin(item, stages) : item], []);

/**
 * Этапы нового flow: Вопросы, Definition of Done, Выбор этапов и Демонстрация — только встроенные виды, чьи навыки плагин везёт в `skills/`.
 * Этап-навык сослался бы на навык, которого у поставившего плагин нет. Названия — данные владельца; начальные — английские, языка сервер не знает.
 */
export const DEFAULT_STAGES: readonly WorkStage[] = withBuiltins(["questions", "criteria", "select", "demo"]);

const DEFAULT_FLOW_ID = "default";
const DEFAULT_FLOW_NAME = "Default";

export const newFlow = (id: string, name: string): Flow => ({ id, name, stages: [...DEFAULT_STAGES] });

/** Этап с видом и без флага review. */
const withKind = ({ review: _review, ...stage }: WorkStage): WorkStage => ({ ...stage, kind: stageKindOf(stage) });

/**
 * Этапы flow до видов — в этапы с видами. Выбор этапов встаёт за ведущими Вопросами и Definition of Done, если его нет;
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

/** Описание flow без краевых пробелов; пустое снимает поле — flow без описания правило выбора flow так и помечает. */
export const withDescription = (flow: Flow, description: string): Flow => {
  const { description: _, ...rest } = flow;
  const trimmed = description.trim();
  return trimmed === "" ? rest : { ...rest, description: trimmed };
};

export const describeFlow = (settings: FlowSettings, id: string, description: string): FlowSettings => mapFlow(settings, id, (flow) => withDescription(flow, description));

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

/**
 * Выбор «без flow»: тред идёт без этапов и без вклада Flow в ход. Id занят под
 * этот выбор и ни одному flow не достаётся: свои раздаёт страница — `flow-…` у
 * созданных и `default` у первого.
 */
export const NO_FLOW = "none";

/** Выбор «Автоматически»: flow треду выбирает агент по описаниям flow, а пока не выбрал — у треда flow нет. */
export const AUTO_FLOW = "auto";

/** Тред, который агент оставил без flow: идёт без flow, но, в отличие от выбора владельца, агент может назначить flow позже — когда владелец попросит. */
export const AGENT_NO_FLOW = "none-by-agent";

/**
 * Flow треда или его отсутствие. `NO_FLOW` и `AUTO_FLOW` — отсутствие,
 * остальное — как `flowById`: отличает отказ от flow от неизвестного id,
 * который читается как flow по умолчанию.
 */
export const flowOrNone = (settings: FlowSettings, id: string | undefined): Flow | null => (id === NO_FLOW || id === AUTO_FLOW || id === AGENT_NO_FLOW ? null : flowById(settings, id));

/** Id flow, на которые ссылаются строки «Flow» flow `id`, в порядке строк; неизвестный flow ссылок не даёт. */
const flowRefs = (flows: readonly Flow[], id: string): string[] => flows.find((flow) => flow.id === id)?.stages.flatMap((stage) => (stage.flowId === undefined ? [] : [stage.flowId])) ?? [];

/** Этап вложенного flow под строкой `holder`: id и владелец с префиксом, иначе два включения одного flow слились бы в одну запись прогона. */
const prefixed = (holder: string) => (stage: WorkStage): WorkStage => ({
  ...stage,
  id: `${holder}.${stage.id}`,
  ...(stage.parent === undefined ? {} : { parent: `${holder}.${stage.parent}` }),
});

/** Этапы с развёрнутыми строками; `chain` — flow, уже стоящие в цепочке развёртывания: повтор даёт ноль этапов, цикл не вешает чтение. */
const expandIn = (flows: readonly Flow[], stages: readonly WorkStage[], chain: readonly string[]): WorkStage[] =>
  stages.flatMap((stage) => {
    if (stage.flowId === undefined) return [stage];
    const inner = flows.find((flow) => flow.id === stage.flowId);
    return inner === undefined || chain.includes(inner.id) ? [] : expandIn(flows, inner.stages, [...chain, inner.id]).map(prefixed(stage.id));
  });

/**
 * Этапы flow, какими их читают прогон, бриф и инструкции: строка «Flow» заменена этапами вложенного flow на своём месте.
 * Удалённый flow даёт ноль этапов.
 */
export const expandStages = (flows: readonly Flow[], flow: Flow): WorkStage[] => expandIn(flows, flow.stages, [flow.id]);

/** Вся коллекция с развёрнутыми этапами каждого flow: так правила порядка шагов читают flow, каким его видит прогон. */
export const withExpandedStages = (flows: readonly Flow[]): Flow[] => flows.map((flow) => ({ ...flow, stages: expandStages(flows, flow) }));

/** Первая цепочка id flow, замкнувшаяся на себя, — от её первого flow и обратно в него; без цикла пусто. */
export const flowCycle = (flows: readonly Flow[]): string[] => {
  const walk = (id: string, path: readonly string[]): string[] => {
    const at = path.indexOf(id);
    return at !== -1 ? [...path.slice(at), id] : flowRefs(flows, id).reduce<string[]>((found, next) => (found.length > 0 ? found : walk(next, [...path, id])), []);
  };
  return flows.reduce<string[]>((found, flow) => (found.length > 0 ? found : walk(flow.id, [])), []);
};

/** Достигает ли flow `outerId` flow `innerId` через строки «Flow»; сам до себя — только по циклу. */
export const includesFlow = (flows: readonly Flow[], outerId: string, innerId: string): boolean => {
  const reach = (id: string, seen: readonly string[]): boolean => flowRefs(flows, id).some((next) => next === innerId || (!seen.includes(next) && reach(next, [...seen, next])));
  return reach(outerId, [outerId]);
};

/** Flow, которые можно поставить строкой в flow `flowId`: не он сам и не те, что включают его, — иначе строка замкнула бы цикл. */
export const nestableFlows = (flows: readonly Flow[], flowId: string): Flow[] => flows.filter((flow) => flow.id !== flowId && !includesFlow(flows, flow.id, flowId));

/** Новая строка «Flow»: этап навыка без навыка и исполнителей, с названием flow; id свободен среди `taken`. */
export const flowStage = (flow: Pick<Flow, "id" | "name">, taken: readonly string[]): WorkStage => ({
  id: freeId("nested-flow", taken),
  kind: "skill",
  skill: "",
  name: flow.name,
  executors: [],
  flowId: flow.id,
});

/** Этапы flow, с развёрнутыми строками «Flow», и общая ширина кнопки — форма, которую проверяет бриф и видят инструкции. */
export const stageSettingsOf = (settings: FlowSettings, flow: Flow): StageSettings => ({ stages: expandStages(settings.flows, flow), minButtonWidth: settings.minButtonWidth });

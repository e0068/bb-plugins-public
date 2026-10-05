// Коллекция flow ⇄ файлы папки синхронизации. Flow — файл `<Имя>.flow.json`;
// flow, на который ссылается строка «Flow», лежит папкой `<Имя>/` рядом с
// файлом того, кто ссылается, — раскладка дерево, и цикл в ней не выразить.
// Ссылки в файлах — по имени: id flow у каждого компа свои. Общее на коллекцию
// — `settings.json` в корне. Сборка обратно отдаёт кандидата, а не коллекцию:
// схему коллекции проверяет оболочка. Из контракта — только типы.
import type { Flow, FlowSettings, StageTemplate, WorkStage } from "../shared/contract";

export const SETTINGS_FILE = "settings.json";
export const FLOW_FILE_SUFFIX = ".flow.json";

/** Этап в файле: ссылка `flow` — имя flow вместо его id. */
export type FileStage = { id: string; flow?: string; [field: string]: unknown };
export type FlowFile = { name: string; description?: string; stages: FileStage[] };
/** `settings.json`: порядок flow по именам и общее на коллекцию; шаблоны этапов ссылаются по имени. */
export type CollectionFile = { order: string[]; stageTemplates?: Array<{ flow?: string; [field: string]: unknown }>; [field: string]: unknown };
export type FolderFlow = { path: string; flow: FlowFile };
export type FolderFile = { path: string; text: string };
export type Assembled = { kind: "ok"; settings: FlowSettings } | { kind: "error"; message: string };

const FORBIDDEN = /[/\\:*?"<>|\u0000-\u001f]/g;

/** Имя файла и папки flow: недопустимые в файловой системе символы — `-`, краевые точки и пробелы срезаны. */
export const flowFileName = (name: string): string => name.replace(FORBIDDEN, "-").replace(/^[\s.]+|[\s.]+$/g, "") || "flow";

/** Имя как ключ: два имени, дающие один файл на нечувствительной к регистру системе, — одно имя. */
const nameKey = (name: string): string => flowFileName(name).toLowerCase();

/** Первое имя, совпавшее по ключу с более ранним; повторов нет — null. */
export const duplicateFlowName = (flows: readonly Pick<Flow, "name">[]): string | null =>
  flows.find((flow, i) => flows.slice(0, i).some((other) => nameKey(other.name) === nameKey(flow.name)))?.name ?? null;

/** `base`, а занятое — `base 2`, `base 3`… */
export const freeFlowName = (flows: readonly Pick<Flow, "name">[], base: string): string => {
  const taken = new Set(flows.map((flow) => nameKey(flow.name)));
  const free = (n: number): string => {
    const name = n === 1 ? base : `${base} ${n}`;
    return taken.has(nameKey(name)) ? free(n + 1) : name;
  };
  return free(1);
};

/** Повторы имён получают номера по порядку коллекции; без повторов коллекция возвращается та же. */
export const withUniqueNames = (settings: FlowSettings): FlowSettings =>
  duplicateFlowName(settings.flows) === null
    ? settings
    : { ...settings, flows: settings.flows.reduce<Flow[]>((done, flow) => [...done, { ...flow, name: freeFlowName(done, flow.name) }], []) };

/** Ключи по алфавиту на всех уровнях: одна и та же коллекция пишет одни и те же байты. */
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]))
      : value;

const serialize = (value: unknown): string => `${JSON.stringify(canonical(value), null, 2)}\n`;

/** `flowId` строки — имя flow; ссылка на удалённый flow в файл не идёт. */
const refByName = <T extends { flowId?: string | undefined }>(byId: ReadonlyMap<string, Flow>) => ({ flowId, ...rest }: T) => {
  const target = flowId === undefined ? undefined : byId.get(flowId);
  return target === undefined ? rest : { ...rest, flow: target.name };
};

const flowToFile = (flow: Flow, byId: ReadonlyMap<string, Flow>): FlowFile => ({
  name: flow.name,
  ...(flow.description === undefined ? {} : { description: flow.description }),
  stages: flow.stages.map(refByName<WorkStage>(byId)),
});

const collectionToFile = ({ flows, version: _version, stageTemplates, ...rest }: FlowSettings, byId: ReadonlyMap<string, Flow>): CollectionFile => ({
  ...rest,
  order: flows.map((flow) => flow.name),
  ...(stageTemplates === undefined ? {} : { stageTemplates: stageTemplates.map(refByName<StageTemplate>(byId)) }),
});

/** Id flow, на которые ссылаются строки flow, без повторов и без удалённых. */
const refsOf = (flow: Flow, byId: ReadonlyMap<string, Flow>): string[] => [
  ...new Set(flow.stages.flatMap((stage) => (stage.flowId !== undefined && byId.has(stage.flowId) ? [stage.flowId] : []))),
];

/** Flow в порядке обхода раскладки: верхний уровень по порядку коллекции, под каждым — вложенные; путь — id от верхнего. */
const walkLayout = (settings: FlowSettings): Array<{ flow: Flow; chain: string[] }> => {
  const byId = new Map(settings.flows.map((flow) => [flow.id, flow]));
  const referenced = new Set(settings.flows.flatMap((flow) => refsOf(flow, byId)));
  const walk = (flow: Flow, chain: string[]): Array<{ flow: Flow; chain: string[] }> => [
    { flow, chain },
    ...refsOf(flow, byId).filter((id) => !chain.includes(id)).flatMap((id) => walk(byId.get(id)!, [...chain, id])),
  ];
  const tops = settings.flows.filter((flow) => !referenced.has(flow.id)).flatMap((flow) => walk(flow, [flow.id]));
  const placed = new Set(tops.map((row) => row.flow.id));
  return [...tops, ...settings.flows.filter((flow) => !placed.has(flow.id)).flatMap((flow) => walk(flow, [flow.id]))];
};

/** Дерево flow для страницы — та же раскладка, что в папке синхронизации; глубина — уровень вложенности. */
export const flowOutline = (settings: FlowSettings): Array<{ id: string; name: string; depth: number }> =>
  walkLayout(settings).map(({ flow, chain }) => ({ id: flow.id, name: flow.name, depth: chain.length - 1 }));

/**
 * Файлы папки: `settings.json`, затем flow верхнего уровня в порядке коллекции, каждый со своими вложенными.
 * Flow, до которого не дойти сверху, — только при цикле — встаёт в корень: в папку попадает каждый.
 */
export const toFlowFiles = (settings: FlowSettings): FolderFile[] => {
  const byId = new Map(settings.flows.map((flow) => [flow.id, flow]));
  const byIdName = (id: string) => flowFileName(byId.get(id)!.name);
  const flowFiles = walkLayout(settings)
    .map(({ flow, chain }) => ({ path: `${chain.slice(1).map((id) => `${byIdName(id)}/`).join("")}${flowFileName(flow.name)}${FLOW_FILE_SUFFIX}`, text: serialize(flowToFile(flow, byId)) }))
    .filter((file, i, all) => all.findIndex((other) => other.path === file.path) === i);
  return [{ path: SETTINGS_FILE, text: serialize(collectionToFile(settings, byId)) }, ...flowFiles];
};

/** Id flow из имени: одно и то же на любом компе, чтобы новый flow из папки не плодил разные id. */
const idFromName = (name: string): string => {
  const hash = [...nameKey(name)].reduce((h, ch) => Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0, 2166136261);
  return `flow-${hash.toString(36)}`;
};

type Copies = { flow: FlowFile; paths: string[] };

const byName = (files: readonly FolderFlow[]): Map<string, Copies> =>
  files.reduce((map, { path, flow }) => {
    const key = nameKey(flow.name);
    const seen = map.get(key);
    return new Map(map).set(key, seen === undefined ? { flow, paths: [path] } : { ...seen, paths: [...seen.paths, path] });
  }, new Map<string, Copies>());

const differentCopies = (files: readonly FolderFlow[]): string | null => {
  const texts = new Map<string, Set<string>>();
  files.forEach(({ flow }) => texts.set(nameKey(flow.name), (texts.get(nameKey(flow.name)) ?? new Set()).add(serialize(flow))));
  const key = [...texts.entries()].find(([, set]) => set.size > 1)?.[0];
  if (key === undefined) return null;
  const paths = files.filter(({ flow }) => nameKey(flow.name) === key).map((f) => f.path);
  return `Copies of flow "${files.find(({ flow }) => nameKey(flow.name) === key)!.flow.name}" differ: ${paths.join(", ")}`;
};

/** Ссылка по имени — id; имени нет среди flow папки — ошибка с тем, кто ссылается. */
const resolveRef = (ids: ReadonlyMap<string, string>, holder: string) => <T extends { flow?: string }>({ flow, ...rest }: T): { kind: "ok"; value: Omit<T, "flow"> & { flowId?: string } } | { kind: "error"; message: string } => {
  if (flow === undefined) return { kind: "ok", value: rest };
  const id = ids.get(nameKey(flow));
  return id === undefined ? { kind: "error", message: `${holder} refers to flow "${flow}", but its file is missing` } : { kind: "ok", value: { ...rest, flowId: id } };
};

type Resolved<T> = { kind: "ok"; values: T[] } | { kind: "error"; message: string };

const resolveAll = <T extends { flow?: string }>(items: readonly T[], resolve: ReturnType<typeof resolveRef>): Resolved<Omit<T, "flow"> & { flowId?: string }> =>
  items.reduce<Resolved<Omit<T, "flow"> & { flowId?: string }>>((acc, item) => {
    if (acc.kind === "error") return acc;
    const one = resolve(item);
    return one.kind === "error" ? one : { kind: "ok", values: [...acc.values, one.value] };
  }, { kind: "ok", values: [] });

/**
 * Кандидат коллекции из файлов папки. Копии одного flow совпадают, каждая ссылка находит flow, иначе — ошибка: недоехавшая папка
 * не должна стать коллекцией. Id — местный по имени или из имени; порядок — из `settings.json`, остальные — по путям; общее без
 * `settings.json` — местное. Схему коллекции здесь не проверить: этапы из файла — то, что в нём лежит.
 */
export const fromFlowFiles = (files: readonly FolderFlow[], collection: CollectionFile | null, local: FlowSettings): Assembled => {
  if (files.length === 0) return { kind: "error", message: "The folder has no flow files" };
  const differ = differentCopies(files);
  if (differ !== null) return { kind: "error", message: differ };
  const flows = [...byName(files).values()].sort((a, b) => (a.paths[0]! < b.paths[0]! ? -1 : 1));
  const localIds = new Map(local.flows.map((flow) => [nameKey(flow.name), flow.id]));
  const ids = new Map(flows.map(({ flow }) => [nameKey(flow.name), localIds.get(nameKey(flow.name)) ?? idFromName(flow.name)]));
  const order = (collection?.order ?? []).map(nameKey);
  const rank = (name: string) => (order.includes(nameKey(name)) ? order.indexOf(nameKey(name)) : order.length);
  const ranked = [...flows].sort((a, b) => rank(a.flow.name) - rank(b.flow.name));
  const built = ranked.reduce<Resolved<Flow>>((acc, { flow }) => {
    if (acc.kind === "error") return acc;
    const stages = resolveAll(flow.stages, resolveRef(ids, `Flow "${flow.name}"`));
    if (stages.kind === "error") return stages;
    const next = { id: ids.get(nameKey(flow.name))!, name: flow.name, ...(flow.description === undefined ? {} : { description: flow.description }), stages: stages.values as unknown as WorkStage[] };
    return { kind: "ok", values: [...acc.values, next] };
  }, { kind: "ok", values: [] });
  if (built.kind === "error") return built;
  const { flows: _flows, version: _version, ...localRest } = local;
  const { order: _order, stageTemplates, ...shared } = collection ?? { order: [] };
  const templates = stageTemplates === undefined ? null : resolveAll(stageTemplates, resolveRef(ids, "A stage template"));
  if (templates !== null && templates.kind === "error") return templates;
  const sharedPart = collection === null ? localRest : { ...shared, ...(templates === null ? {} : { stageTemplates: templates.values }) };
  return { kind: "ok", settings: { ...(sharedPart as Omit<FlowSettings, "flows">), flows: built.values, version: 2 } };
};

/** Первая встреча с папкой: коллекция из папки, а местные flow с именами, которых в ней нет, — в конец; ничего не теряется. */
export const withLocalFlows = (disk: FlowSettings, local: FlowSettings): FlowSettings => {
  const onDisk = new Set(disk.flows.map((flow) => nameKey(flow.name)));
  return { ...disk, flows: [...disk.flows, ...local.flows.filter((flow) => !onDisk.has(nameKey(flow.name)))] };
};

/** Что сделать с папкой: записать, убрать, и чужие правки, оставленные на месте, — их потом забирает чтение папки. */
export type WritePlan = { writes: Array<[string, string]>; removes: string[]; kept: string[] };

/**
 * Запись коллекции в папку против последней сверки `base` — трёхсторонне, по файлу. Файл на диске таков же, как при сверке, —
 * пишется своё или убирается лишнее. Поменялся на диске, а своё не менялось, — остаётся чужое: его привёз другой комп, или это не
 * файл Flow вовсе. Поменялся с обеих сторон — выигрывает своё последнее сохранение; правка сильнее удаления с любой стороны.
 */
export const planWrite = (wanted: ReadonlyMap<string, string>, present: ReadonlyMap<string, string>, base: ReadonlyMap<string, string>): WritePlan => {
  const paths = [...new Set([...wanted.keys(), ...present.keys()])].sort();
  return paths.reduce<WritePlan>(
    (plan, path) => {
      const mine = wanted.get(path);
      const disk = present.get(path);
      const was = base.get(path);
      if (disk === mine) return plan;
      const theirsChanged = disk !== was;
      if (theirsChanged && (mine === was || mine === undefined)) return { ...plan, kept: [...plan.kept, path] };
      return mine === undefined ? { ...plan, removes: [...plan.removes, path] } : { ...plan, writes: [...plan.writes, [path, mine]] };
    },
    { writes: [], removes: [], kept: [] },
  );
};

// Под-этапы flow: этап с `parent` стоит вплотную к владельцу — выше идёт до него,
// ниже после — и включается вместе с ним. Номера, связка, перетаскивание по зонам
// строки, одна галочка на связку и удаление — здесь, одни для страницы, брифа,
// полосы прогресса и сервера.
import { stageKindOf } from "../lib/stage-constants";
import type { WorkStage } from "../shared/contract";

type Linked = { id: string; parent?: string | undefined };

/** Четверть строки под указателем: 1 — над строкой, 2 — под-этап до неё, 3 — под-этап после, 4 — под строкой. */
export type DropZone = 1 | 2 | 3 | 4;

/** Номер этапа — его место среди этапов верхнего уровня, с 1; у под-этапа номера нет. */
export const stageNumbers = (stages: readonly Linked[]): ReadonlyMap<string, number | null> => {
  const top = stages.filter((stage) => stage.parent === undefined).map((stage) => stage.id);
  return new Map(stages.map((stage) => [stage.id, stage.parent === undefined ? top.indexOf(stage.id) + 1 : null]));
};

/** Под-этапы владельца в порядке списка. */
export const subStagesOf = (stages: readonly Linked[], id: string): string[] => stages.filter((stage) => stage.parent === id).map((stage) => stage.id);

/** Владелец под-этапа; у этапа верхнего уровня — `null`. */
export const ownerOf = (stages: readonly Linked[], id: string): string | null => stages.find((stage) => stage.id === id)?.parent ?? null;

/** Связка этапа — владелец с под-этапами и его под-этапы, по id владельца; у этапа без под-этапов и за краем списка — `null`. */
const linkOf = (stages: readonly Linked[], stage: Linked | undefined): string | null =>
  stage === undefined ? null : (stage.parent ?? (stages.some((other) => other.parent === stage.id) ? stage.id : null));

/** Отходит ли строка `at` от строки выше: на границе связки; `at` за концом списка — отходит ли то, что идёт после него. */
export const linkApart = (stages: readonly Linked[], at: number): boolean => linkOf(stages, stages[at]) !== (at === 0 ? null : linkOf(stages, stages[at - 1]));

/**
 * Охват встроенного этапа номерами верхнего уровня: Выбор — до следующего Выбора, Демонстрация — с прошлой Демонстрации.
 * Охватывать нечего — `null`.
 */
export const stageScope = (stages: readonly WorkStage[], index: number): [number, number] | null => {
  const kinds = stages.map(stageKindOf);
  const own = kinds[index];
  const bound = (from: number, step: 1 | -1): number => {
    let at = from;
    while (at >= 0 && at < kinds.length && kinds[at] !== own) at += step;
    return at;
  };
  const [first, last] = own === "select" ? [index + 1, bound(index + 1, 1) - 1] : [bound(index - 1, -1) + 1, index - 1];
  const numbers = stageNumbers(stages);
  const covered = stages.slice(Math.max(0, first), last + 1).flatMap((stage) => numbers.get(stage.id) ?? []);
  return covered.length === 0 ? null : [covered[0]!, covered[covered.length - 1]!];
};

/** Какие этапы меняет одна галочка: владелец — всю связку; снятый под-этап — себя; возвращённый — себя и владельца. */
export const runCascade = (stages: readonly Linked[], id: string, run: boolean): string[] => {
  const owner = ownerOf(stages, id);
  if (owner === null) return [id, ...subStagesOf(stages, id)];
  return run ? [id, owner] : [id];
};

/** Список без этапа; под-этапы удалённого владельца остаются на местах этапами верхнего уровня. */
export const removeStage = (stages: readonly WorkStage[], id: string): WorkStage[] =>
  stages.filter((stage) => stage.id !== id).map((stage) => (stage.parent === id ? withoutParent(stage) : stage));

const withoutParent = ({ parent: _, ...stage }: WorkStage): WorkStage => stage;

/** Куда встаёт перетаскиваемое: рядом с этапом `anchor` — перед ним или после — под владельцем `parent` или наверху. */
type Place = { anchor: string; after: boolean; parent: string | null };

/**
 * Место по зоне целевой строки. Крайняя зона встаёт в связку, только когда граница лежит внутри неё — между строками одной
 * связки; на внешнем краю связки место наверху. Средние зоны под-этапа ведут в его связку рядом с ним.
 */
const placeOf = (stages: readonly WorkStage[], target: WorkStage, zone: DropZone): Place => {
  const after = zone >= 3;
  const link = target.parent ?? target.id;
  const at = stages.indexOf(target);
  const neighbour = stages[after ? at + 1 : at - 1];
  const inside = neighbour !== undefined && (neighbour.parent ?? neighbour.id) === link && (neighbour.parent !== undefined || target.parent !== undefined);
  const middle = zone === 2 || zone === 3;
  return { anchor: target.id, after, parent: middle || inside ? link : null };
};

/**
 * Список после того, как этап `dragId` отпустили в зоне `zone` строки `targetId`; сюда нельзя — `null`.
 * Владелец едет вместе со связкой и сам в чужую связку не встаёт; на себя и на свой под-этап этап не падает.
 */
export const dropStage = (stages: readonly WorkStage[], dragId: string, targetId: string, zone: DropZone): WorkStage[] | null => {
  const target = stages.find((stage) => stage.id === targetId);
  const dragged = stages.find((stage) => stage.id === dragId);
  if (target === undefined || dragged === undefined || dragId === targetId || target.parent === dragId) return null;
  const moving = dragged.parent === undefined ? stages.filter((stage) => stage.id === dragId || stage.parent === dragId) : [dragged];
  const place = placeOf(stages, target, zone);
  if (place.parent !== null && moving.length > 1) return null;
  const placed = moving.map((stage) => (stage.id !== dragId ? stage : place.parent === null ? withoutParent(stage) : { ...stage, parent: place.parent }));
  const rest = stages.filter((stage) => !moving.includes(stage));
  const anchor = rest.findIndex((stage) => stage.id === place.anchor);
  const at = place.after ? anchor + 1 : anchor;
  return [...rest.slice(0, at), ...placed, ...rest.slice(at)];
};


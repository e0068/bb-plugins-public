// Этапы вложенного flow в развёрнутом списке: строка flow собирает их под собой, номера идут с точкой — 2, 2.1, 2.2,
// а под-этапы номера не получают. Одни для брифа, полосы прогона и страницы Flow.
import type { NestRef } from "../shared/contract";

type Nested = { id: string; parent?: string | undefined; nest?: readonly NestRef[] | undefined };

/** Узел дерева: этап или строка вложенного flow со всеми своими этапами (`stages`) и их деревом уровнем ниже (`children`). */
export type NestNode<T extends Nested> = { kind: "stage"; stage: T } | { kind: "flow"; flow: NestRef; stages: T[]; children: NestNode<T>[] };

/** Подряд идущие этапы с одной строкой flow на уровне `depth`; этап без строки на этом уровне — сам по себе. */
const runsAt = <T extends Nested>(stages: readonly T[], depth: number): T[][] =>
  stages.reduce<T[][]>((runs, stage) => {
    const id = stage.nest?.[depth]?.id;
    const last = runs.at(-1);
    return id !== undefined && last?.[0]?.nest?.[depth]?.id === id ? [...runs.slice(0, -1), [...last, stage]] : [...runs, [stage]];
  }, []);

const treeAt = <T extends Nested>(stages: readonly T[], depth: number): NestNode<T>[] =>
  runsAt(stages, depth).map((run) => {
    const flow = run[0]!.nest?.[depth];
    return flow === undefined ? { kind: "stage", stage: run[0]! } : { kind: "flow", flow, stages: run, children: treeAt(run, depth + 1) };
  });

/** Дерево развёрнутого списка: этапы вложенного flow — одним узлом на месте первого из них. */
export const nestTree = <T extends Nested>(stages: readonly T[]): NestNode<T>[] => treeAt(stages, 0);

/** Узел, которому положен номер: этап верхнего уровня, посчитанный `counted`, или flow, где такой есть. */
const numbered =
  <T extends Nested>(counted: (stage: T) => boolean) =>
  (node: NestNode<T>): boolean =>
    node.kind === "stage" ? node.stage.parent === undefined && counted(node.stage) : node.stages.some((stage) => stage.parent === undefined && counted(stage));

const placesIn = <T extends Nested>(nodes: readonly NestNode<T>[], counted: (stage: T) => boolean, prefix: string): Array<[string, string]> =>
  nodes.filter(numbered(counted)).flatMap((node, at): Array<[string, string]> => {
    const place = `${prefix}${at + 1}`;
    return node.kind === "stage" ? [[node.stage.id, place]] : [[node.flow.id, place], ...placesIn(node.children, counted, `${place}.`)];
  });

/**
 * Номер каждого этапа и строки flow: место среди соседей своего уровня, с номером строки flow через точку. Под-этап и этап,
 * не посчитанный `counted`, — например, вычеркнутый из прогона, — номера не получают и места не занимают.
 */
export const stagePlaces = <T extends Nested>(stages: readonly T[], counted: (stage: T) => boolean = () => true): ReadonlyMap<string, string> =>
  new Map(placesIn(nestTree(stages), counted, ""));

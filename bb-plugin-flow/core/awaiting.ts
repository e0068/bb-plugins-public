// Слой 1 — чисто. Чего ждёт тред: вид ожидания брифа Flow и разница двух
// списков ждущих тредов — какие значки поставить и какие снять.
import type { BuiltinKind } from "../lib/stage-constants";
import type { AwaitingKind, DecisionBrief } from "../shared/contract";

/** Вид ожидания; `null` — бриф владельца не держит (уточнение). */
export const awaitingKind = (brief: DecisionBrief): BuiltinKind | null => {
  if (brief.kind === "clarify") return null;
  if (brief.outcome !== undefined) return "demo";
  if (brief.questions.length > 0) return "questions";
  if (brief.setup?.criteria !== undefined) return "criteria";
  if (brief.setup?.stages !== undefined) return "select";
  return "questions";
};

/** Новые и сменившие значок треды — поставить, ушедшие — снять. */
export const awaitingChanges = <K>(prev: ReadonlyMap<string, K>, next: ReadonlyMap<string, K>): { set: Array<[string, K]>; clear: string[] } => ({
  set: [...next.entries()].filter(([id, kind]) => prev.get(id) !== kind),
  clear: [...prev.keys()].filter((id) => !next.has(id)),
});

/**
 * Держит ли ожидание владельца: бриф ждёт его ответа, и работа продолжится с
 * ответа, а не с реплики. Ожидание автоматизации и этапа Action — не бриф:
 * его снимает сам прогон, когда владелец нажимает кнопку в баннере.
 */
export const waitsForAnswer = (kind: AwaitingKind): boolean => kind !== "automation" && kind !== "action";

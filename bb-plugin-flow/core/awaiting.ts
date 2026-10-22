// Слой 1 — чисто. Чего ждёт тред: вид ожидания брифа Flow и разница двух
// списков ждущих тредов — какие значки поставить и какие снять.
import type { BuiltinKind } from "../lib/stage-constants";
import type { AwaitingEntry, AwaitingKind, DecisionBrief, RowStage, WorkStage } from "../shared/contract";
import { outcomeKind } from "./outcome";

/** Вид ожидания; `null` — бриф владельца не держит: уточнение и Демонстрация, которая закрывается самой отправкой. */
export const awaitingKind = (brief: DecisionBrief): BuiltinKind | null => {
  if (brief.kind === "clarify") return null;
  if (brief.outcome !== undefined) return outcomeKind(brief) === "approve" ? "approve" : null;
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

/** Id ожидания упавшей автоматизации: его снимает повтор или пропуск шага этого этапа. */
export const automationAwaitingId = (stageId: string): string => `automation:${stageId}`;

/** Id ожидания этапа Action — своё: его снимает нажатие, а не повтор упавшей автоматизации. */
export const actionAwaitingId = (stageId: string): string => `action:${stageId}`;

/** Этап, на котором стоит ожидание автоматизации или Action; ожидание брифа этапа не называет — `null`. */
export const awaitingStageId = (entry: AwaitingEntry): string | null => (waitsForAnswer(entry.kind) ? null : entry.briefId.slice(entry.briefId.indexOf(":") + 1));

/** Своя иконка этапа для строки треда — название этапа и имя иконки; нет этапа или иконки — `undefined`. */
export const ownStageIcon = (stage: Pick<WorkStage, "name" | "icon"> | undefined): RowStage | undefined =>
  stage?.icon === undefined ? undefined : { name: stage.name, icon: stage.icon };

/**
 * Возвращает ли сообщение ждущий бриф агенту: пишет владелец, а не агент, и это не повтор упавшего хода; вклинившееся
 * в идущий ход тоже. Сообщение, которое другой плагин отправил от имени владельца, — комментарий из Tasks+ — тоже его слова.
 */
export const returnsBrief = ({ initiator, retry }: { initiator: string; retry: boolean }): boolean => initiator === "user" && !retry;

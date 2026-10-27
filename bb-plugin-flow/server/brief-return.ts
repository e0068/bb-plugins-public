// Сообщение владельца в чат, пока бриф Flow ждёт ответа, — отклонение от плана: бриф возвращается агенту.
// Ожидание снимается — значок в левой панели гаснет, и побудка после автоматизации больше не считает, что тред
// ждёт кнопку. Бриф помечается возвращённым, виджет сворачивается в строку, а следующий бриф треда забирает его черновик.
// Ждущее утверждение судится по виджетам выше, поэтому сворачивается вся группа — как от комментария к нему; прочее — один бриф.
// Вопросы, Definition of Done и Выбор этапов, чьи ответы копятся до Утверждения, прогон не держит и в списке ждущих их нет: сворачивается
// последний виджет группы, если владелец его ещё не отвечал. Решённый агентом виджет только показывает решение — его сообщение не трогает.
import { waitsForAnswer } from "../core/awaiting";
import type { DecisionStore } from "./store";

export type BriefReturnDeps = {
  store: Pick<
    DecisionStore,
    "listAwaiting" | "clearAwaiting" | "foldGroup" | "foldSingle" | "putThreadReturned" | "getThreadGroup" | "getBrief" | "getAnswer" | "getFold" | "isReturned"
  >;
  /** Виджет брифа перечитывает его и сворачивается. */
  publish: (briefId: string) => void;
};

/** Последний виджет группы треда, чьи ответы копятся до Утверждения и который владелец не отвечал и не сворачивал: его id или `null`. */
const openSettledBrief = async (store: BriefReturnDeps["store"], threadId: string): Promise<string | null> => {
  const id = (await store.getThreadGroup(threadId))?.ids.at(-1);
  if (id === undefined) return null;
  const brief = await store.getBrief(id);
  const closed = brief === null || brief.settle !== "approval" || brief.outcome !== undefined || (await store.getAnswer(id)) !== null || (await store.isReturned(id)) || (await store.getFold(id)) !== null;
  return closed ? null : id;
};

const returnSettledBrief = async (deps: BriefReturnDeps, threadId: string): Promise<string | null> => {
  const id = await openSettledBrief(deps.store, threadId);
  if (id === null) return null;
  const folded = await deps.store.foldSingle(id);
  await deps.store.putThreadReturned(threadId, id);
  folded.forEach((foldedId) => deps.publish(foldedId));
  return id;
};

/** Возвращает бриф, которого ждёт тред; ответ — его id, `null` — тред брифа не ждал, а кнопок автоматизации и этапа Action это не касается. */
export const returnAwaitingBrief = async (deps: BriefReturnDeps, threadId: string): Promise<string | null> => {
  const entry = (await deps.store.listAwaiting()).find((e) => e.threadId === threadId && waitsForAnswer(e.kind));
  if (entry === undefined) return returnSettledBrief(deps, threadId);
  // Сперва метки, потом снятие ожидания: бриф, переставший ждать, уже возвращён и отдаст черновик.
  const folded = entry.kind === "approve" ? await deps.store.foldGroup(threadId, entry.briefId) : await deps.store.foldSingle(entry.briefId);
  await deps.store.putThreadReturned(threadId, entry.briefId);
  await deps.store.clearAwaiting(threadId, entry.briefId);
  folded.forEach((id) => deps.publish(id));
  return entry.briefId;
};

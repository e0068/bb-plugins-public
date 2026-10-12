// Сообщение владельца в чат, пока бриф Flow ждёт ответа, — отклонение от плана: бриф возвращается агенту.
// Ожидание снимается — значок в левой панели гаснет, и побудка после автоматизации больше не считает, что тред
// ждёт кнопку. Бриф помечается возвращённым, виджет сворачивается в строку, а следующий бриф треда забирает его черновик.
// Ждущее утверждение судится по виджетам выше, поэтому сворачивается вся группа — как от комментария к нему; прочее — один бриф.
import { waitsForAnswer } from "../core/awaiting";
import type { DecisionStore } from "./store";

export type BriefReturnDeps = {
  store: Pick<DecisionStore, "listAwaiting" | "clearAwaiting" | "foldGroup" | "foldSingle" | "putThreadReturned">;
  /** Виджет брифа перечитывает его и сворачивается. */
  publish: (briefId: string) => void;
};

/** Возвращает бриф, которого ждёт тред; ответ — его id, `null` — тред брифа не ждал, а кнопок автоматизации и этапа Action это не касается. */
export const returnAwaitingBrief = async (deps: BriefReturnDeps, threadId: string): Promise<string | null> => {
  const entry = (await deps.store.listAwaiting()).find((e) => e.threadId === threadId && waitsForAnswer(e.kind));
  if (entry === undefined) return null;
  // Сперва метки, потом снятие ожидания: бриф, переставший ждать, уже возвращён и отдаст черновик.
  const folded = entry.kind === "approve" ? await deps.store.foldGroup(threadId, entry.briefId) : await deps.store.foldSingle(entry.briefId);
  await deps.store.putThreadReturned(threadId, entry.briefId);
  await deps.store.clearAwaiting(threadId, entry.briefId);
  folded.forEach((id) => deps.publish(id));
  return entry.briefId;
};

// Слой 1 — чисто. Уточнение — вопросы без остановки работы; одна строка «да/нет» отвечается нажатием, любые другие вопросы
// рисуются формой брифа.
import type { AgentTurn, DecisionAnswer, DecisionBrief } from "../shared/contract";

/** Уточнение из одного вопроса да/нет: отвечается одним нажатием, без кнопки отправки. */
export const isQuickClarify = (brief: Pick<DecisionBrief, "kind" | "questions">): boolean =>
  brief.kind === "clarify" && brief.questions.length === 1 && brief.questions[0]?.kind === "yesno";

/** Статус треда в bb; новый статус bb — ошибка компиляции в `turnOf`, а не молчаливое «ход идёт». */
export type ThreadStatus = "active" | "error" | "idle" | "pending" | "starting" | "stopping";

/** Ход агента по статусу треда в bb: идёт, пока тред запускается, работает или останавливается; простой и сбой — ход кончился. */
export const turnOf = (status: ThreadStatus): AgentTurn => {
  switch (status) {
    case "pending":
    case "starting":
    case "active":
    case "stopping":
      return "running";
    case "idle":
    case "error":
      return "ended";
  }
};

/**
 * Ответ на уточнение приходит в идущий ход: агент не стоит, поэтому место, переход в другой flow и исполнитель
 * у него снимаются — иначе ответ запустил бы вторую копию работы в новом треде. Сжатие снимается, только пока ход идёт:
 * посреди хода оно срезало бы работу агента, а после хода сжимает тред, как у брифа.
 */
export const settleClarifyAnswer = (brief: Pick<DecisionBrief, "kind">, answer: DecisionAnswer, turn: AgentTurn = "running"): DecisionAnswer => {
  if (brief.kind !== "clarify") return answer;
  const { place: _place, route: _route, compact, flow: _flow, execution: _execution, outcome: _outcome, ...kept } = answer;
  return turn === "ended" && compact === true ? { ...kept, compact } : kept;
};

/** Что про уточнение, названное в `resolves`, знает хранилище: чьё оно, какого вида и отвечено ли; `null` — такого виджета нет. */
export type ResolveTarget = { threadId: string; kind: DecisionBrief["kind"]; answered: boolean } | null;

/**
 * Агент закрывает как решённые только неотвеченные уточнения своего треда: чужой, неизвестный и отвеченный виджет —
 * отказ, ответ владельца решённым не перекрывается. Отказ называет каждый плохой id.
 */
export const resolvesIssues = (threadId: string, targets: ReadonlyArray<readonly [id: string, target: ResolveTarget]>): string[] =>
  targets.flatMap(([id, target]) => {
    if (target === null || target.threadId !== threadId) return [`resolves ${id} is not a clarify of this thread`];
    if (target.kind !== "clarify") return [`resolves ${id} is not a clarify: only a clarify is closed this way`];
    return target.answered ? [`resolves ${id} is already answered by the owner: its answer stands`] : [];
  });

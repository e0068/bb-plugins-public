// Чистая часть группы Утверждения: правки виджетов, копящих ответ до него, их ответы для отправки и подпись главной кнопки.
// Отдельно от хука группы: тестам и другим модулям не нужен клиент RPC.
import type { Messages } from "../lib/messages";
import type { DecisionBrief, GroupAnswer } from "../shared/contract";
import { acceptRecommendations, decidedCount, initialDraft, toAnswer, type Draft } from "./draft";
import { withRestored } from "./draft-restore";
import { readStoredDraft } from "./draft-storage";

/** Виджет, который прогон не держит, открывается на рекомендациях агента: по ним агент и работает, пока владелец не поправит. */
export const settledInitial = (brief: DecisionBrief): Draft => withRestored(brief, acceptRecommendations(brief, initialDraft(brief)));

/** Черновик виджета группы: правленый владельцем — из окна, нетронутый — тот, с которым виджет открылся. */
export const memberDraft = (member: DecisionBrief): Draft => readStoredDraft(member.id) ?? settledInitial(member);

const blank = (text: string | undefined): boolean => text === undefined || text.trim() === "";

/** Сколько правок владелец внёс в виджет: ответы не по рекомендации, правки пунктов, этапы, комментарий. */
export const memberEdits = (member: DecisionBrief, draft: Draft): number => {
  const comment = blank(draft.note) ? 0 : 1;
  if (member.outcome !== undefined) return comment;
  const before = toAnswer(member, settledInitial(member));
  const after = toAnswer(member, draft);
  const answers = after.answers.filter((a) => JSON.stringify(a) !== JSON.stringify(before.answers.find((b) => b.questionId === a.questionId))).length;
  const stages = (after.stages ?? []).filter((a) => JSON.stringify(a) !== JSON.stringify((before.stages ?? []).find((b) => b.id === a.id))).length;
  const criteria = draft.criteria.removed.length + Object.keys(draft.criteria.edited).length + draft.criteria.added.filter((text) => !blank(text)).length;
  return answers + stages + criteria + comment;
};

/** Ответ виджета группы для отправки с Утверждением: бриф — ответ из черновика, Демонстрация — только комментарий. */
export const memberAnswer = (member: DecisionBrief, draft: Draft): GroupAnswer =>
  member.outcome !== undefined ? { id: member.id, ...(blank(draft.note) ? {} : { note: draft.note.trim() }) } : { id: member.id, answer: toAnswer(member, draft) };

/**
 * Подпись главной кнопки Утверждения: выбранный flow — «Отправить»; комментарий — «Отправить комментарии»; правки виджетов —
 * «Продолжить с правками · N»; финальное без правок — «Завершить»; иначе — «Продолжить».
 */
export const approveLabel = (state: { moves: boolean; commented: boolean; edits: number; finishes: boolean }, t: Messages["outcome"]): string => {
  if (state.moves) return t.send;
  if (state.commented) return t.rework;
  if (state.edits > 0) return t.approveWithEdits(state.edits);
  return state.finishes ? t.finish : t.continue;
};

/**
 * Решены ли все вопросы виджета группы: развилка без рекомендации ждёт выбора владельца, и Утверждение без него не утверждает.
 * Уточнение необязательно — без ответа агент работает по своему пониманию, поэтому Утверждение оно не держит.
 */
export const memberDecided = (member: DecisionBrief, draft: Draft): boolean => {
  if (member.kind === "clarify") return true;
  const { decided, total } = decidedCount(member, draft);
  return decided === total;
};

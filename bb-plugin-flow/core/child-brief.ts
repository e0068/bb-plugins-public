// Слой 1 — чисто. Бриф запуска тред-потомка адресуется родителю: работой дочерних управляет он, и владелец карточку не получает.
// Утверждение и Демонстрация остаются владельцу: агент не утверждает работу агентов (BBPL-951).
import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { awaitingKind } from "./awaiting";
import { criterionTitle } from "./budget";
import { recommendedAnswer } from "./settle";
import { recommendedStageChoice, stageItems, stagePhase } from "./stages";

/** Инструмент, которым родитель отвечает на бриф потомка. */
export const CHILD_ANSWER_TOOL = "answer_child_brief";

/** Бриф запуска — Вопросы, Definition of Done, Выбор этапов: он уходит родителю. Утверждение, Демонстрация и уточнение — владельцу. */
export const routesToParent = (brief: DecisionBrief): boolean => brief.kind === "brief" && brief.outcome === undefined;

/** Ждёт ли бриф запуска ответа родителя: решённый агентом — Утверждения впереди нет — спрашивать не о чем. */
export const asksParent = (brief: DecisionBrief): boolean => brief.settle !== "agent";

/** Этапы из `include`, которых в прогон взять нельзя: нет в брифе или уже пройдены. Пусто — брать можно все. */
export const unusableStages = (brief: DecisionBrief, include: readonly string[]): string[] => {
  const todo = stageItems(brief).filter((item) => stagePhase(item) === "todo").map((item) => item.stage.id);
  return include.filter((id) => !todo.includes(id));
};

/** Ответ родителя — как ответ владельца кнопкой: рекомендованные варианты, пункты и прогон, комментарий — свободным текстом ко всему брифу. Этапы из `include` встают в прогон и без рекомендации. */
export const childAnswerOf = (brief: DecisionBrief, comment?: string, include: readonly string[] = []): DecisionAnswer => {
  const note = comment?.trim() ?? "";
  const recommended = recommendedAnswer(brief);
  return {
    ...recommended,
    ...(recommended.stages === undefined ? {} : { stages: recommended.stages.map((choice) => (include.includes(choice.id) ? { ...choice, run: true } : choice)) }),
    ...(note === "" ? {} : { note }),
  };
};

/** Реплика родителю: какой бриф потомка ждёт его ответа или решён агентом и может быть изменён, что в нём — объём, пункты, прогон, рекомендованные ответы — и как ответить. */
export const parentNotice = (childThreadId: string, brief: DecisionBrief): string => {
  const run = stageItems(brief).filter((item) => recommendedStageChoice(item).run).map((item) => item.stage.name);
  const questions = brief.questions.map((q) => `${q.question} → ${q.options.filter((o) => o.recommended).map((o) => o.action).join(", ") || "—"}`);
  return [
    `[Flow] Child thread @thread:${childThreadId} asks you, not the owner: the owner sees no card of this brief.`,
    `- "${brief.title}" (${brief.id})`,
    ...(brief.scope === undefined ? [] : [`  Scope: ${brief.scope.replace(/\n/g, " ")}`]),
    ...(brief.setup?.criteria ?? []).map((item) => `  Definition of Done: ${criterionTitle(item)}`),
    ...(run.length === 0 ? [] : [`  Run: ${run.join(" → ")}`]),
    ...questions.map((line) => `  Question: ${line}`),
    asksParent(brief)
      ? `Answer with ${CHILD_ANSWER_TOOL} { briefId: "${brief.id}" } to accept the recommendations, add comment: "…" to give the child your words, or include: ["<stage id>"] to take a stage into its run that it did not recommend. Ask the owner yourself only what you cannot decide.`
      : `The child already works on these recommendations: with no approval ahead they are the decision. Answer with ${CHILD_ANSWER_TOOL} { briefId: "${brief.id}" } only to change them: include: ["<stage id>"] takes a stage into its run that it did not recommend, comment: "…" gives the child your words.`,
  ].join("\n");
};

/** Ответ инструмента потомку: строки карточки нет, бриф ушёл родителю; ждать ли ответа — по тому, держит ли бриф ход и решён ли он. */
export const childBriefResult = (brief: DecisionBrief, parentThreadId: string): string => {
  const next =
    awaitingKind(brief) !== null
      ? "End the turn and wait: the parent's answer arrives as a message in this thread."
      : asksParent(brief)
        ? "Keep working on the recommended values; the parent's answer may arrive along the way."
        : "Keep working on the recommended values: with no approval ahead they are the decision; the parent's answer may arrive along the way and change them.";
  return `Brief ${brief.id} went to the parent thread ${parentThreadId}: the work of a child thread is managed by its parent, so the owner gets no card. There is no decision line to paste. ${next}`;
};

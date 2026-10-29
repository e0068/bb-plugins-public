// Инструмент `answer_child_brief` — ответ родителя на бриф запуска своего потомка. Такой бриф владельцу карточкой не встаёт (./ask-tool.ts),
// и решение родителя ложится тем же путём, что ответ кнопкой виджета: запись, прогон, реплика в дочерний тред (BBPL-951).
// Утверждение и Демонстрацию потомка принимает только владелец: агент не утверждает работу агентов.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { CHILD_ANSWER_TOOL, asksParent, childAnswerOf, routesToParent, unusableStages } from "../core/child-brief";
import type { AnswerBrief } from "./api";
import type { DecisionStore } from "./store";

export { CHILD_ANSWER_TOOL };

const paramsSchema = z.object({
  briefId: z.string().describe("Id (dec_…) of the child's brief, from the Flow message in this thread"),
  comment: z.string().optional().describe("Your words to the child: they go as a note to the whole brief. Omit to accept the recommendations"),
  include: z.array(z.string()).optional().describe("Ids of stages to take into the child's run although it did not recommend them, e.g. [\"demo\"]. Only stages of the brief that are not done yet"),
});

const toolError = (text: string) => ({ isError: true as const, content: [{ type: "text" as const, text }] });
const toolText = (text: string) => ({ content: [{ type: "text" as const, text }] });

export const registerChildAnswerTool = (
  bb: Pick<BbPluginApi, "agents">,
  store: DecisionStore,
  deps: {
    answerBrief: AnswerBrief;
    /** Родитель, который ведёт работу треда; `null` — тред без такого родителя или bb не ответил. */
    parentOf: (threadId: string) => Promise<string | null>;
    newId: () => string;
  },
): void => {
  bb.agents.registerTool({
    name: CHILD_ANSWER_TOOL,
    description:
      "Answer a launch brief of your child thread — questions, Definition of Done, stage selection: Flow routes it to the parent instead of showing the owner a card. The recommendations are accepted; include adds stages the child did not recommend to its run; a comment goes as a note to the brief. The answer reaches the child as a message. A child's approval and demo are the owner's.",
    parameters: paramsSchema,
    async execute({ briefId, comment, include }, ctx) {
      const brief = await store.getBrief(briefId);
      const parent = brief === null ? null : await deps.parentOf(brief.threadId).catch(() => null);
      if (brief === null || parent !== ctx.threadId) return toolError(`${briefId} is not a brief of your child thread.`);
      if (!routesToParent(brief)) return toolError(`${briefId} is not a launch brief: the owner answers a child's approval, demo and clarification.`);
      // Решённый агентом бриф уже принят рекомендациями: ответ без изменений разбудил бы потомка впустую.
      if (!asksParent(brief) && (include ?? []).length === 0 && (comment ?? "").trim() === "") return toolError(`${briefId} is already decided on its recommendations: answer only to change them — with include or comment.`);
      const unusable = unusableStages(brief, include ?? []);
      if (unusable.length > 0) return toolError(`Stages not available to take into the run: ${unusable.join(", ")} — they are not in the brief or already done.`);
      try {
        const result = await deps.answerBrief({ id: brief.id, answer: childAnswerOf(brief, comment, include), messageId: deps.newId() });
        switch (result.kind) {
          case "accepted":
            return toolText(`Answer to "${brief.title}" delivered to the child thread ${brief.threadId}.`);
          case "already_answered":
            return toolError(`${briefId} is already answered.`);
          case "not_found":
            return toolError(`${briefId} is not found.`);
          case "incomplete":
            return toolError(`${briefId} has questions with no recommended option: ${result.questionIds.join(", ")} — tell the child thread to send it again with an option recommended on each.`);
        }
      } catch (error) {
        return toolError(`The answer was not accepted: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  });
};

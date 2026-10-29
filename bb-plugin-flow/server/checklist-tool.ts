// Инструмент flow_checklist: агент отмечает выполненные пункты чек-листа по комментариям владельца к виджетам. Карточка под ответом
// Утверждения перечитывается тем же событием, что и отвеченный бриф, — владелец видит отметки сразу.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { CHECKLIST_TOOL, openItems, tick } from "../core/checklist";
import { ANSWERED_CHANNEL } from "./api";
import type { DecisionStore } from "./store";

const toolError = (text: string) => ({ isError: true as const, content: [{ type: "text" as const, text }] });

/** `allDone` зовётся, когда отмечен последний пункт: автоматизации, ждавшие чек-лист, пора запускать. */
export const registerChecklistTool = (bb: Pick<BbPluginApi, "agents" | "realtime">, store: Pick<DecisionStore, "getChecklist" | "putChecklist">, allDone: (threadId: string) => void = () => undefined): void => {
  bb.agents.registerTool({
    name: CHECKLIST_TOOL,
    description: "Mark items of the checklist from the owner's comments on the widgets as done; the next stage of the run starts only when every item is done.",
    instructions: `Call ${CHECKLIST_TOOL} with the ids of the checklist items you finished, as you finish them. The checklist comes in the answer of an approval the owner sent with comments on the widgets above it.`,
    presentation: { label: { pending: "Marking the checklist", completed: "Checklist marked" } },
    parameters: z.object({ done: z.array(z.string().min(1)).min(1) }),
    async execute({ done }, ctx) {
      const checklist = await store.getChecklist(ctx.threadId);
      if (checklist === null) return toolError("This thread has no checklist: nothing was marked.");
      const { items, unknown } = tick(checklist.items, done);
      if (unknown.length > 0) return toolError(`Unknown checklist items: ${unknown.join(", ")}; the items are ${checklist.items.map((item) => item.id).join(", ")}. Nothing was marked.`);
      await store.putChecklist(ctx.threadId, { ...checklist, items });
      bb.realtime.publish(ANSWERED_CHANNEL, { id: checklist.approvalId });
      const open = openItems(items);
      if (open.length > 0) return `Marked. Still open: ${open.map((item) => item.id).join(", ")}.`;
      allDone(ctx.threadId);
      return "Every checklist item is done: go on with the next stage of the run.";
    },
  });
};

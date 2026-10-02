// Инструмент выбора flow агентом: тред, созданный с выбором «Автоматически», получает flow, который агент нашёл
// по описаниям flow из инструкций хода. Ответ несёт этапы flow — по ним работа идёт уже в этом ходе. Свой отказ
// от flow агент может пересмотреть, когда владелец просит работать через flow; отказ владельца — нет.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { AGENT_NO_FLOW, AUTO_FLOW, NO_FLOW } from "../core/flows";
import { CHOOSE_FLOW_TOOL } from "../lib/stage-constants";
import type { FlowSettingsStore } from "./flow-settings";
import type { ThreadFlows } from "./thread-flows";

const toolText = (text: string) => ({ content: [{ type: "text" as const, text }] });
const toolError = (text: string) => ({ isError: true as const, content: [{ type: "text" as const, text }] });

/** Тред, которому flow выбирает агент: «Автоматически» до выбора и после собственного отказа агента. */
const agentChooses = (flowId: string | undefined): boolean => flowId === AUTO_FLOW || flowId === AGENT_NO_FLOW;

export const registerChooseFlow = (
  bb: Pick<BbPluginApi, "agents">,
  deps: {
    flows: FlowSettingsStore;
    threads: Pick<ThreadFlows, "flowOf" | "assign">;
    /** Вклад Flow в ход треда — после назначения уже с этапами выбранного flow. */
    instructions: (threadId: string) => string;
    /** Заводит треду пустой прогон назначенного flow. */
    started: (threadId: string) => Promise<void>;
  },
): void => {
  bb.agents.registerTool({
    name: CHOOSE_FLOW_TOOL,
    description: "Give this thread, which has no flow yet, the owner's flow that fits the request, or a flow the owner asks for in a thread you left without one. The turn instructions list the flows and when to choose each. The answer lists the stages of the chosen flow.",
    presentation: { label: { pending: "Choosing the flow", completed: "Flow chosen" } },
    parameters: z.object({ flowId: z.string().describe(`Id of the chosen flow from the turn instructions, or "${NO_FLOW}" when no flow fits`) }),
    async execute({ flowId }, ctx) {
      const settings = deps.flows.current();
      // Flow треда выбирает владелец; агенту — только тред с «Автоматически» или его собственным отказом.
      if (!agentChooses(deps.threads.flowOf(ctx.threadId))) return toolError("This thread already has a flow or none; only the owner changes it.");
      // Ни один flow не подошёл: тред идёт без flow, но отказ помечен агентским — по просьбе владельца flow назначится.
      if (flowId === NO_FLOW) {
        await deps.threads.assign(ctx.threadId, AGENT_NO_FLOW);
        return toolText("The thread stays without a flow; work as usual.");
      }
      if (!settings.flows.some((flow) => flow.id === flowId)) return toolError(`Unknown flow "${flowId}". Flows: ${settings.flows.map((flow) => flow.id).join(", ")}.`);
      await deps.threads.assign(ctx.threadId, flowId);
      await deps.started(ctx.threadId);
      return toolText(deps.instructions(ctx.threadId));
    },
  });
};

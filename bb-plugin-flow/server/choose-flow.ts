// Инструмент выбора flow агентом: тред, где выбрано «без flow», при включённом выборе агентом получает flow,
// который агент нашёл по корневому навыку. Ответ несёт этапы flow — по ним работа идёт уже в этом ходе.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { AGENT_NO_FLOW, NO_FLOW } from "../core/flows";
import { CHOOSE_FLOW_TOOL, ROOT_SKILL } from "../lib/stage-constants";
import type { FlowSettingsStore } from "./flow-settings";
import type { ThreadFlows } from "./thread-flows";

const toolText = (text: string) => ({ content: [{ type: "text" as const, text }] });
const toolError = (text: string) => ({ isError: true as const, content: [{ type: "text" as const, text }] });

export const registerChooseFlow = (
  bb: Pick<BbPluginApi, "agents">,
  deps: {
    flows: FlowSettingsStore;
    threads: Pick<ThreadFlows, "flowOf" | "assign">;
    /** Вклад Flow в ход треда — после назначения уже с этапами выбранного flow. */
    instructions: (threadId: string) => string;
  },
): void => {
  bb.agents.registerTool({
    name: CHOOSE_FLOW_TOOL,
    description: `Give this thread, which has no flow yet, the owner's flow that fits the request. Pick it by the skill \`${ROOT_SKILL}\`, which lists the flows and when to choose each. The answer lists the stages of the chosen flow.`,
    presentation: { label: { pending: "Choosing the flow", completed: "Flow chosen" } },
    parameters: z.object({ flowId: z.string().describe(`Id of the chosen flow from the skill, or "${NO_FLOW}" when no flow fits`) }),
    async execute({ flowId }, ctx) {
      const settings = deps.flows.current();
      // Flow треда выбирает владелец; агенту — только тред, где выбрано «без flow», и только с его разрешения.
      if (settings.agentChoosesFlow !== true) return toolError("The owner has not let the agent choose a flow; work without one.");
      if (deps.threads.flowOf(ctx.threadId) !== NO_FLOW) return toolError("This thread already has a flow; only the owner changes it.");
      // Ни один flow не подошёл: тред остаётся без flow, но уже по выбору агента — второй раз выбрать не предложат.
      if (flowId === NO_FLOW) {
        await deps.threads.assign(ctx.threadId, AGENT_NO_FLOW);
        return toolText("The thread stays without a flow; work as usual.");
      }
      if (!settings.flows.some((flow) => flow.id === flowId)) return toolError(`Unknown flow "${flowId}". Flows: ${settings.flows.map((flow) => flow.id).join(", ")}.`);
      await deps.threads.assign(ctx.threadId, flowId);
      return toolText(deps.instructions(ctx.threadId));
    },
  });
};

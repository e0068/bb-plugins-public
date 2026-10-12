// Инструмент выбора flow агентом: тред, созданный с выбором «Автоматически», получает flow, который агент нашёл
// по описаниям flow из инструкций хода. Ответ несёт стартовое сообщение и этапы flow — по ним работа идёт уже в этом ходе:
// собранная сессия своих инструкций не меняет, а новой сессии после выбора нет. Модель и effort flow тред получает со следующего хода.
// Свой отказ от flow агент пересматривает сам, когда разговор дошёл до работы; отказ владельца — нет.
// Выбор, который владелец успел сделать над композером, пока агент решал, выигрывает у выбора агента.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { AGENT_NO_FLOW, AUTO_FLOW, flowById, NO_FLOW } from "../core/flows";
import { CHOOSE_FLOW_TOOL } from "../lib/stage-constants";
import type { FlowSettingsStore } from "./flow-settings";
import type { ThreadFlows } from "./thread-flows";

const toolText = (text: string) => ({ content: [{ type: "text" as const, text }] });
const toolError = (text: string) => ({ isError: true as const, content: [{ type: "text" as const, text }] });

/** Выбор владельца над композером, сделанный, пока агент решал: `null` — «Без flow». */
const ownerPickNote = (name: string | null) =>
  `The owner picked ${name === null ? "no flow" : `flow "${name}"`} for this thread above the composer while you were choosing, and the owner's pick wins over yours.`;

/** Тред, которому flow выбирает агент: «Автоматически» до выбора и после собственного отказа агента. */
const agentChooses = (flowId: string | undefined): boolean => flowId === AUTO_FLOW || flowId === AGENT_NO_FLOW;

export const registerChooseFlow = (
  bb: Pick<BbPluginApi, "agents">,
  deps: {
    flows: FlowSettingsStore;
    threads: Pick<ThreadFlows, "flowOf" | "assign" | "takePicked">;
    /** Вклад Flow в ход треда — после назначения уже с этапами выбранного flow. */
    instructions: (threadId: string) => string;
    /** Заводит треду пустой прогон назначенного flow. */
    started: (threadId: string) => Promise<void>;
    /** Агент назначенного flow: ставит треду его модель и отдаёт стартовое сообщение; `null` — сообщения нет. Не задано — ничего. */
    agent?: (threadId: string) => Promise<string | null>;
    /** Агент оставил тред без flow: настройки треда сверяются, и спрятанное до выбора возвращается. Не задано — ничего. */
    refused?: (threadId: string) => Promise<void>;
  },
): void => {
  bb.agents.registerTool({
    name: CHOOSE_FLOW_TOOL,
    description: "Give this thread, which has no flow yet, the owner's flow that fits the request, or, in a thread you left without one, the flow that fits once the conversation comes to work. The turn instructions list when no flow is needed and the flows with when to choose each. The answer lists the stages of the chosen flow.",
    presentation: { label: { pending: "Choosing the flow", completed: "Flow chosen" } },
    parameters: z.object({ flowId: z.string().describe(`Id of the chosen flow from the turn instructions, or "${NO_FLOW}" when no flow is needed or none of them fits`) }),
    async execute({ flowId }, ctx) {
      const settings = deps.flows.current();
      // Flow треда выбирает владелец; агенту — только тред с «Автоматически» или его собственным отказом.
      if (!agentChooses(deps.threads.flowOf(ctx.threadId))) return toolError("This thread already has a flow or none; only the owner changes it.");
      // «Автоматически» над композером — тот же выбор агенту; любой другой выбор владельца ставится вместо выбора агента.
      const picked = await deps.threads.takePicked(ctx.threadId);
      const owners = picked === AUTO_FLOW ? undefined : picked;
      if (owners === undefined && flowId !== NO_FLOW && !settings.flows.some((flow) => flow.id === flowId))
        return toolError(`Unknown flow "${flowId}". Flows: ${settings.flows.map((flow) => flow.id).join(", ")}.`);
      // Flow не нужен или ни один не подошёл: тред идёт без flow, но отказ помечен агентским — дойдёт до работы, агент назначит flow сам.
      const chosen = owners ?? (flowId === NO_FLOW ? AGENT_NO_FLOW : flowId);
      const none = chosen === NO_FLOW || chosen === AGENT_NO_FLOW;
      await deps.threads.assign(ctx.threadId, chosen);
      await (none ? deps.refused?.(ctx.threadId) : deps.started(ctx.threadId));
      const start = none ? null : await (deps.agent?.(ctx.threadId) ?? Promise.resolve(null)).catch(() => null);
      const stages = none ? "The thread stays without a flow; work as usual." : deps.instructions(ctx.threadId);
      const reply = start === null ? stages : `The flow's start message for you:\n\n${start}\n\n${stages}`;
      // Выбор владельца, не совпавший с выбором агента, называется: агент работает не по тому, что выбрал сам.
      if (owners === undefined || owners === flowId) return toolText(reply);
      return toolText(`${ownerPickNote(none ? null : flowById(settings, owners).name)}\n\n${reply}`);
    },
  });
};

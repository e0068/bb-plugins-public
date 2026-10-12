// Инструмент агента `retry_automation`: «Повторить» упавшего шага автоматизации — тем же раннером, что и кнопка владельца.
// Вызов, как отметка этапа перед автоматизацией, ждёт конца шага и отдаёт итог в ответе: агент в том же ходе видит,
// прошёл повтор или упал снова. Допустим ли повтор и что сказать в ответе — в core/agent-retry.ts.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { notStartedReply, retriedReply, retryVerdict } from "../core/agent-retry";
import { stopFailure } from "../core/mark-report";
import { EMPTY_PROGRESS } from "../core/progress";
import { RETRY_AUTOMATION_TOOL } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { RELAY_WAIT_MS, type AgentRelay } from "./agent-relay";
import type { AutomationRunner } from "./automation-runner";
import type { ProgressStore } from "./progress";

const toolError = (text: string) => ({ isError: true as const, content: [{ type: "text" as const, text }] });

export const registerRetryTool = (
  bb: Pick<BbPluginApi, "agents">,
  deps: {
    stages: (threadId: string) => StageSettings;
    progress: Pick<ProgressStore, "get" | "carrier">;
    runner: Pick<AutomationRunner, "retry">;
    relay: Pick<AgentRelay, "hold">;
    /** Сколько мс вызов ждёт конец шага; нет — 10 минут. */
    waitMs?: number;
  },
): void => {
  bb.agents.registerTool({
    name: RETRY_AUTOMATION_TOOL,
    description:
      "Retry the failed step of an automation stage of this thread's flow — the same as the owner's Retry button above the composer. Call it when a step failed and waits for the owner, and only once the cause is fixed. The call waits until the step ends and answers with the outcome. Skip stays the owner's: it is not available here.",
    presentation: { label: { pending: "Retrying the step", completed: "Step retried" } },
    parameters: z.object({ stage: z.string().describe("The id of the automation stage whose step failed") }),
    async execute({ stage }, ctx) {
      const stages = deps.stages(ctx.threadId).stages;
      // Работа ушла в другой тред: его прогон двигает только он, иначе два треда вели бы одну работу наперебой.
      const carrier = await deps.progress.carrier(ctx.threadId);
      if (carrier !== ctx.threadId)
        return toolError(`The work of this thread's flow run was handed off to thread ${carrier}: that thread carries the run now — do not retry its steps from here. Nothing was started.`);
      const verdict = retryVerdict(stages, (await deps.progress.get(ctx.threadId)) ?? EMPTY_PROGRESS, stage);
      if (verdict.kind === "refused") return toolError(verdict.reason);
      // Ожидание встаёт до повтора: шаг может доиграть раньше, чем вызов начнёт ждать, и реплика Flow не должна уйти в тред.
      const hold = deps.relay.hold(ctx.threadId);
      try {
        const answer = await deps.runner.retry(ctx.threadId, stage);
        if (!answer.started) return toolError(notStartedReply(answer));
        const outcome = await hold.wait({ ms: deps.waitMs ?? RELAY_WAIT_MS, signal: ctx.signal });
        const failure = outcome.kind === "quiet" ? stopFailure(stages, (await deps.progress.get(ctx.threadId)) ?? EMPTY_PROGRESS) : null;
        return retriedReply(verdict.stage, outcome, failure);
      } finally {
        hold.release();
      }
    },
  });
};

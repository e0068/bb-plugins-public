// Следующий прогон в том же треде. Завершённый прогон агента не будит, и
// первое слово остаётся за владельцем: его сообщение Flow придерживает хуком
// `message.dispatch` до выбора flow. Ответ формы отпускает сообщение, и порядок
// здесь и есть суть узла: сперва flow — иначе ход пойдёт по прежним этапам,
// потом компактация — иначе она срежет придержанное, и лишь затем повторный
// вопрос хуку, на который тот, уже без завершённого прогона, ответит «иди».
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { AUTO_FLOW, NO_FLOW } from "../core/flows";
import { appliesPickedFlow, holdsForNextFlow } from "../core/next-run-hold";
import { nextRunRpcContract } from "../shared/contract";
import type { FlowSettingsStore } from "./flow-settings";
import type { ProgressStore } from "./progress";
import type { ThreadFlows } from "./thread-flows";

type DispatchContext = Parameters<Parameters<BbPluginApi["experimental_hooks"]["on"]>[1]>[0];

/** Автор хода: bb кладёт его в контекст хука, а типы SDK его пока не описывают; без него — владелец, как у сообщения из композера. */
const initiatorOf = (context: DispatchContext): string => {
  const initiator = (context as { initiator?: unknown }).initiator;
  return typeof initiator === "string" ? initiator : "user";
};

/** Придержано ли сообщение треда до выбора flow: строка очереди ждёт этот плагин. */
export const heldFor =
  (bb: Pick<BbPluginApi, "sdk" | "pluginId">) =>
  async (threadId: string): Promise<boolean> => {
    const rows = await bb.sdk.threads.queuedMessages.list({ threadId });
    return rows.some((row) => row.waitingOn?.kind === "plugin" && row.waitingOn.pluginId === bb.pluginId);
  };

export const registerNextRun = (
  bb: Pick<BbPluginApi, "rpc" | "sdk" | "experimental_hooks" | "pluginId">,
  deps: {
    flows: FlowSettingsStore;
    threads: ThreadFlows;
    /** Запись прошлого прогона снимается: его этапы закрыты, и новый прогон начинается с чистой. */
    progress: Pick<ProgressStore, "remove">;
    /** Завершён ли прогон треда. */
    finished: (threadId: string) => Promise<boolean>;
    /** Подпись придержанного сообщения в очереди — на языке плагина. */
    heldReason: () => string;
    /** Своя отправка Flow — её хук пропускает (./own-sends.ts). */
    ownSend: (threadId: string, text: string) => boolean;
    /** Владелец начинает ход: flow, выбранный над композером, достаётся треду до того, как ход получит инструкции (./flow-choice.ts). */
    ownerTurn?: (threadId: string) => Promise<void>;
  },
): void => {
  const heldIn = heldFor(bb);

  bb.experimental_hooks.on("message.dispatch", async (context) => {
    if (deps.ownSend(context.thread.id, context.input.text)) return { action: "proceed" };
    const turn = { attempt: context.attempt, initiator: initiatorOf(context), retry: context.queuedMessage?.payload.kind === "retry" };
    // Хук, который бросает, запирает тред: сбой применения выбора и чтения прогона пропускает сообщение.
    if (deps.ownerTurn !== undefined && appliesPickedFlow(turn)) await deps.ownerTurn(context.thread.id).catch(() => undefined);
    const finished = await deps.finished(context.thread.id).catch(() => false);
    return holdsForNextFlow({ finished, ...turn }) ? { action: "wait", reason: deps.heldReason() } : { action: "proceed" };
  });

  bb.rpc.register(nextRunRpcContract, {
    nextRunFlows: async () => ({ flows: deps.flows.current().flows.map(({ id, name }) => ({ id, name })) }),

    nextRunHeld: async ({ threadId }) => ({ held: await heldIn(threadId) }),

    async startNextRun({ threadId, flowId, compact }) {
      if (flowId !== NO_FLOW && flowId !== AUTO_FLOW && !deps.flows.current().flows.some((flow) => flow.id === flowId)) return { kind: "failed" as const, reason: "unknown-flow" };
      try {
        // Отпускать нечего — второе нажатие или устаревшая форма: иначе снялся бы уже начатый прогон.
        if (!(await heldIn(threadId))) return { kind: "failed" as const, reason: "not-held" };
        await deps.threads.assign(threadId, flowId);
        // Итог прошлого прогона уже заморожен под своим брифом, поэтому запись можно снять целиком.
        await deps.progress.remove(threadId);
        if (compact) await bb.sdk.threads.compact({ threadId });
        await bb.experimental_hooks.recheck("message.dispatch");
        return { kind: "sent" as const };
      } catch (error) {
        // Сообщение не отпущено — оно ждёт в очереди, и повтор формы дойдёт.
        return { kind: "failed" as const, reason: error instanceof Error ? error.message : String(error) };
      }
    },
  });
};

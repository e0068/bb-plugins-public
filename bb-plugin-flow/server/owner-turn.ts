// Хук `message.dispatch` — раньше инструкций хода. Первое сообщение треда даёт ему flow и прогон (./thread-start.ts);
// ход владельца применяет flow, выбранный в контейнере состояния Flow над композером. Сообщение не придерживается
// никогда: тред без flow виден в самом контейнере, а ход после завершённого прогона начинает следующий — с выбранным
// flow или с «Автоматически» (./flow-choice.ts). Сообщение владельца при ждущем брифе возвращает бриф агенту.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { returnsBrief } from "../core/awaiting";
import { appliesPickedFlow } from "../core/picked-flow";
import type { FirstMessage } from "./thread-start";

type DispatchContext = Parameters<Parameters<BbPluginApi["experimental_hooks"]["on"]>[1]>[0];

/** Автор хода: bb кладёт его в контекст хука, а типы SDK его пока не описывают; без него — владелец, как у сообщения из композера. */
const initiatorOf = (context: DispatchContext): string => {
  const initiator = (context as { initiator?: unknown }).initiator;
  return typeof initiator === "string" ? initiator : "user";
};

/** Треды, упомянутые в сообщении, по порядку. */
const mentionedThreads = (context: DispatchContext): string[] =>
  context.input.blocks.flatMap((block) =>
    block.type === "text" ? (block.mentions ?? []).flatMap((mention) => (mention.resource.kind === "thread" ? [mention.resource.threadId] : [])) : [],
  );

export const registerOwnerTurn = (
  bb: Pick<BbPluginApi, "experimental_hooks" | "pluginId">,
  deps: {
    /** Первое сообщение треда — тред ещё `pending`: flow и прогон нового треда. */
    firstMessage?: (message: FirstMessage) => Promise<void>;
    /** Своя отправка Flow — ответ на бриф и побудка — выбор не применяет (./own-sends.ts). */
    ownSend: (threadId: string, text: string) => boolean;
    /** Владелец начинает ход: выбранный flow достаётся треду (./flow-choice.ts). */
    ownerTurn: (threadId: string) => Promise<void>;
    /** Владелец пишет в чат — в начале хода или посреди него: ждущий бриф возвращается агенту (./brief-return.ts). */
    ownerMessage?: (threadId: string) => Promise<unknown>;
  },
): void => {
  bb.experimental_hooks.on("message.dispatch", async (context) => {
    // Хук, который бросает, запирает тред: сбой привязки пропускает сообщение.
    if (deps.firstMessage !== undefined && context.thread.status === "pending") {
      const { id, projectId, parentThreadId } = context.thread;
      await deps.firstMessage({ thread: { id, projectId, parentThreadId }, byFlow: context.thread.originPluginId === bb.pluginId, mentioned: mentionedThreads(context) }).catch(() => undefined);
    }
    if (deps.ownSend(context.thread.id, context.input.text)) return { action: "proceed" };
    const turn = { attempt: context.attempt, initiator: initiatorOf(context), retry: context.queuedMessage?.payload.kind === "retry" };
    // Хук, который бросает, запирает тред: сбой применения выбора пропускает сообщение.
    if (appliesPickedFlow(turn)) await deps.ownerTurn(context.thread.id).catch(() => undefined);
    if (returnsBrief(turn)) await deps.ownerMessage?.(context.thread.id).catch(() => undefined);
    return { action: "proceed" };
  });
};

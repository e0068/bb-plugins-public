// Родитель, который ведёт работу треда, — адресат его брифов запуска (../core/child-brief.ts). Дочерний тред передачи работы
// ведёт владелец: её он начал своим брифом, а исходный тред после передачи останавливается (BBPL-951).
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type { DecisionStore } from "./store";

/** `null` — у треда нет такого родителя или bb не ответил: бриф идёт владельцу. */
export const managingParentOf =
  (store: Pick<DecisionStore, "isHandedOff">, sdk: Pick<BbPluginApi["sdk"], "threads">) =>
  async (threadId: string): Promise<string | null> => {
    try {
      return (await store.isHandedOff(threadId)) ? null : ((await sdk.threads.get({ threadId })).parentThreadId ?? null);
    } catch {
      return null;
    }
  };

// Настройки списка тредов bb для встроенного списка внутри слота Flow: слот Flow держит его на месте `Original`, и список
// обращается за настройками к Flow, а не к плагину thread-list. Flow пересылает вызовы thread-list как есть.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { threadListPrefsRpcContract } from "../shared/contract";

const THREAD_LIST_PLUGIN_ID = "thread-list";

export const registerThreadListPrefsApi = (bb: Pick<BbPluginApi, "rpc" | "sdk" | "log">): void => {
  const forward = <T>(method: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T> =>
    bb.sdk.plugins.callRpc({ pluginId: THREAD_LIST_PLUGIN_ID, method, input: input as never, outputSchema });
  bb.rpc.register(threadListPrefsRpcContract, {
    // Не ответил thread-list — пустые настройки: список читает их один раз при первом показе и без ответа висит на заглушке,
    // а с пустыми рисуется с настройками по умолчанию.
    listPreferences: () =>
      forward("listPreferences", null, threadListPrefsRpcContract.listPreferences.output).catch((error) => {
        bb.log.warn(`thread list preferences are not available, the list uses defaults (${error instanceof Error ? error.message : String(error)})`);
        return { preferences: {} };
      }),
    setPreference: (input) => forward("setPreference", input, threadListPrefsRpcContract.setPreference.output),
    resetPreference: (input) => forward("resetPreference", input, threadListPrefsRpcContract.resetPreference.output),
  });
};

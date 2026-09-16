import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { createStore, registerTasksApi } from "./api";
import { registerAttachments } from "./attachments";
import { registerTasksCli } from "./cli";
import { registerDelegation } from "./delegate";
import { registerFolders } from "./folders";
import { createCallerEnvironmentCache } from "./filesync/caller-cache";
import { registerLifecycle } from "./lifecycle";
import { registerMentions } from "./mentions";

export const TASKS_PLUGIN_NAME = "Tasks+";
export const TASKS_PLUGIN_VERSION = "0.1.2";

export const tasksRpcContract = defineRpcContract({
  ping: {
    input: z.null(),
    output: z.object({ ok: z.literal(true), version: z.string() }),
  },
});

function statusPayload() {
  return { name: TASKS_PLUGIN_NAME, version: TASKS_PLUGIN_VERSION };
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info(`${TASKS_PLUGIN_NAME} ${TASKS_PLUGIN_VERSION} loaded`);

  const store = await createStore(bb);
  // Одна память об окружениях на процесс: второй экземпляр удвоил бы
  // обращения к хосту и развёл бы сроки (api/caller-scope.ts).
  const callerEnvironments = createCallerEnvironmentCache(bb);
  registerTasksApi(bb, store, callerEnvironments);
  registerAttachments(bb, store.tasks, { callerEnvironments });
  registerTasksCli(bb, store, statusPayload());
  registerDelegation(bb, store, callerEnvironments);
  registerMentions(bb, store);
  registerFolders(bb, store);
  await registerLifecycle(bb, store);

  bb.rpc.register(tasksRpcContract, {
    ping(): { ok: true; version: string } {
      return { ok: true, version: TASKS_PLUGIN_VERSION };
    },
  });
}

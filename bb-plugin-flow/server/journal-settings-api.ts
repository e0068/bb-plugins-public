// RPC секции настроек пути журнала решений: список проектов с их путями и
// сохранение одного пути. Список проектов и карту путей сшивает сервер —
// фронту нужен только готовый ряд на экран.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { journalSettingsRpcContract } from "../shared/contract";
import type { JournalDirStore } from "./dir-settings";

export const registerJournalSettingsApi = (bb: Pick<BbPluginApi, "rpc" | "sdk">, dirs: JournalDirStore): void => {
  bb.rpc.register(journalSettingsRpcContract, {
    async getJournalProjects() {
      const [projects, configured] = await Promise.all([bb.sdk.projects.list(), dirs.list()]);
      return projects.map((p) => ({ id: p.id, name: p.name, path: configured[p.id] ?? null }));
    },
    setJournalDir: ({ projectId, path }) => dirs.set(projectId, path),
  });
};

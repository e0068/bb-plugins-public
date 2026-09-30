// RPC страницы Flow: чтение и запись коллекции flow и каталог навыков и
// исполнителей, файл навыка по имени и показ его в файловой системе. Запись сообщает открытым вкладкам, что flow поменялись.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { flowSettingsRpcContract, type SkillFile, type StageCatalog } from "../shared/contract";
import type { FlowSettingsStore } from "./flow-settings";

export const STAGE_SETTINGS_CHANNEL = "decisions:stage-settings";

export const registerFlowSettingsApi = (
  bb: Pick<BbPluginApi, "rpc" | "realtime">,
  settings: FlowSettingsStore,
  deps: {
    catalog: () => Promise<StageCatalog>;
    /** Чем кончиться до отдачи коллекции странице: страница пишет коллекцию целиком и не должна держать её копию до разовой чистки. */
    ready?: () => Promise<void>;
    skillFile: (name: string) => Promise<SkillFile>;
    reveal: (path: string) => Promise<{ revealed: boolean; error: string | null }>;
  },
): void => {
  bb.rpc.register(flowSettingsRpcContract, {
    async getFlowSettings() {
      await deps.ready?.();
      return settings.current();
    },
    async saveFlowSettings(next) {
      const saved = await settings.save(next);
      bb.realtime.publish(STAGE_SETTINGS_CHANNEL, {});
      return saved;
    },
    getStageCatalog: () => deps.catalog(),
    getSkillFile: ({ name }) => deps.skillFile(name),
    async revealSkill({ name }) {
      const file = await deps.skillFile(name);
      return file === null ? { revealed: false, error: "skill file not found" } : deps.reveal(file.path);
    },
  });
};

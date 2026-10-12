// @vitest-environment node
// Модель по умолчанию для выбора модели flow: то, что дал сервер, а сбой и пустой каталог — `null`, а не ошибка RPC.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { Execution } from "../shared/contract";
import { createFlowSettings } from "./flow-settings";
import { registerFlowSettingsApi } from "./settings-api";

const opus: Execution = { providerId: "claude-code", model: "opus", reasoningLevel: "high" };

const setup = async (defaultExecution?: () => Promise<Execution | null>) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const settings = await createFlowSettings(bb.storage.kv);
  registerFlowSettingsApi(bb, settings, {
    catalog: async () => ({ skills: [], executors: [] }),
    skillFile: async () => null,
    executorFile: async () => null,
    scriptFile: async () => null,
    reveal: async () => ({ revealed: false, error: null }),
    ...(defaultExecution === undefined ? {} : { defaultExecution }),
  });
  return harness;
};

describe("RPC defaultExecution", () => {
  it("отдаёт модель машины bb", async () => {
    expect(await (await setup(async () => opus)).callRpc("defaultExecution", {})).toEqual(opus);
  });

  it("сбой каталога и отсутствие зависимости — null", async () => {
    expect(await (await setup(async () => Promise.reject(new Error("offline")))).callRpc("defaultExecution", {})).toBeNull();
    expect(await (await setup()).callRpc("defaultExecution", {})).toBeNull();
  });
});

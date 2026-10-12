// @vitest-environment node
// Встроенный список тредов bb, нарисованный внутри слота Flow, зовёт RPC того плагина, чей слот его держит, — то есть Flow:
// listPreferences, setPreference, resetPreference. Flow пересылает их плагину thread-list, где лежат настоящие настройки списка.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { registerThreadListPrefsApi } from "./thread-list-prefs-api";

type Call = { pluginId: string; method: string; input: unknown };

const setup = (answer: (call: Call) => unknown = () => ({})) => {
  const calls: Call[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: { plugins: { callRpc: async (args: Call) => (calls.push({ pluginId: args.pluginId, method: args.method, input: args.input }), answer(args)) } as never },
  });
  registerThreadListPrefsApi(bb);
  return { harness, calls };
};

describe("RPC настроек списка тредов — пересылка в thread-list", () => {
  it("listPreferences отдаёт настройки, которые вернул thread-list", async () => {
    const { harness, calls } = setup(() => ({ preferences: { organizationMode: "project" } }));
    expect(await harness.callRpc("listPreferences", null)).toEqual({ preferences: { organizationMode: "project" } });
    expect(calls).toEqual([{ pluginId: "thread-list", method: "listPreferences", input: null }]);
  });

  it("setPreference передаёт ключ и значение и отдаёт сохранённое", async () => {
    const { harness, calls } = setup(({ input }) => input);
    expect(await harness.callRpc("setPreference", { key: "sortDirection", value: "reverse" })).toEqual({ key: "sortDirection", value: "reverse" });
    expect(calls).toEqual([{ pluginId: "thread-list", method: "setPreference", input: { key: "sortDirection", value: "reverse" } }]);
  });

  it("resetPreference передаёт ключ и отдаёт значение по умолчанию", async () => {
    const { harness, calls } = setup(({ input }) => ({ ...(input as object), value: "default" }));
    expect(await harness.callRpc("resetPreference", { key: "sortDirection" })).toEqual({ key: "sortDirection", value: "default" });
    expect(calls).toEqual([{ pluginId: "thread-list", method: "resetPreference", input: { key: "sortDirection" } }]);
  });

  it("listPreferences при отказе thread-list отдаёт пустые настройки: список рисуется с настройками по умолчанию, а не висит на заглушке", async () => {
    const { harness } = setup(() => {
      throw new Error("thread-list is down");
    });
    expect(await harness.callRpc("listPreferences", null)).toEqual({ preferences: {} });
  });

  it("setPreference при отказе thread-list не прячет ошибку: изменение не сохранилось", async () => {
    const { harness } = setup(() => {
      throw new Error("thread-list is down");
    });
    await expect(harness.callRpc("setPreference", { key: "sortDirection", value: "reverse" })).rejects.toThrow("thread-list is down");
  });
});

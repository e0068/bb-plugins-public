// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { registerApi } from "./api";
import { createStore } from "./store";

const setup = async (projects: unknown) => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: { get: async () => ({ projectId: "proj_1", environmentId: "env_1" }) },
      projects: {
        list: async () => {
          if (projects instanceof Error) throw projects;
          return projects;
        },
      },
    },
  });
  registerApi(bb, createStore(bb.storage.kv), { now: () => "2026-09-18T10:00:00.000Z" });
  return harness;
};

const all = [
  { id: "proj_1", name: "bb-plugins" },
  { id: "proj_2", name: "Cellular" },
  { id: "proj_3", name: "Shader Lab" },
];

describe("список проектов для выбора места", () => {
  it("отдаёт проекты bb без проекта треда", async () => {
    const harness = await setup(all);
    expect(await harness.callRpc("listProjects", { threadId: "thr_src" })).toEqual({
      kind: "found",
      projects: [
        { id: "proj_2", name: "Cellular" },
        { id: "proj_3", name: "Shader Lab" },
      ],
    });
  });

  it("проект в bb один — список пуст, отправлять некуда", async () => {
    const harness = await setup([{ id: "proj_1", name: "bb-plugins" }]);
    expect(await harness.callRpc("listProjects", { threadId: "thr_src" })).toEqual({ kind: "found", projects: [] });
  });

  it("сбой списка читается отказом, а не ошибкой: выбор места из-за него не падает", async () => {
    const harness = await setup(new Error("host unavailable"));
    expect(await harness.callRpc("listProjects", { threadId: "thr_src" })).toEqual({ kind: "unavailable" });
  });
});

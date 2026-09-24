// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const brief: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_src",
  title: "Flow — маршрут",
  createdAt: "2026-09-17T10:00:00.000Z",
  kind: "brief",
  questions: [],
  setup: { criteria: ["Тесты зелёные"] },
};

const setup = async () => {
  const spawned: Array<Record<string, unknown>> = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        send: async () => ({ delivery: "started" }),
        get: async () => ({ projectId: "proj_1", environmentId: "env_1" }),
        spawn: async (args: unknown) => {
          spawned.push(args as Record<string, unknown>);
          return { id: "thr_new" };
        },
      },
      environments: { get: async () => ({ hostId: "host_1", path: "/tree", branchName: "bb/thr_src" }) },
    },
  });
  const store = createStore(bb.storage.kv);
  await store.putBrief(brief);
  registerApi(bb, store, { now: () => "2026-09-17T10:05:00.000Z" });
  const call = (answer: DecisionAnswer) => harness.callRpc("answerBrief", { id: "dec_1", answer, messageId: "msg_1" });
  return { spawned, harness, call };
};

describe("маршрут нового треда в ответе", () => {
  it("новый тред создаётся в дереве и ветке маршрута", async () => {
    const { spawned, call } = await setup();
    await call({ briefId: "dec_1", answers: [], place: "thread", route: { tree: "new", branch: "from-origin-main" } });
    expect(spawned[0]?.environment).toEqual({ type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: "origin/main" } } });
  });

  it("место «в другом проекте» без маршрута не принимается: адрес проекта взять неоткуда", async () => {
    const { spawned, call } = await setup();
    await expect(call({ briefId: "dec_1", answers: [], place: "other" })).rejects.toThrow();
    expect(spawned).toHaveLength(0);
  });

  it("чужой проект без выбранного проекта не принимается: молча уехать в свой работа не должна", async () => {
    const { spawned, call } = await setup();
    await expect(call({ briefId: "dec_1", answers: [], place: "other", route: { tree: "new", branch: "none" } })).rejects.toThrow();
    expect(spawned).toHaveLength(0);
  });

  it("недоступное сочетание дерева и ветки не принимается", async () => {
    const { spawned, call } = await setup();
    await expect(call({ briefId: "dec_1", answers: [], place: "thread", route: { tree: "same", branch: "none" } })).rejects.toThrow();
    await expect(call({ briefId: "dec_1", answers: [], place: "other", route: { tree: "same", branch: "none", projectId: "proj_2" } })).rejects.toThrow();
    expect(spawned).toHaveLength(0);
  });
});

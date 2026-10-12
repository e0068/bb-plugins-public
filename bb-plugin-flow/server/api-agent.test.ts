// @vitest-environment node
// Выбор ряда виджета на сервере: модель и effort — треду и репликой, другой провайдер — только новому треду, flow — переходом;
// каталог ряда собирается из bb и не роняет виджет при сбое.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief, Execution } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const brief: DecisionBrief = {
  id: "dec_a",
  threadId: "thr_1",
  title: "Утверждение",
  createdAt: "2026-10-12T10:00:00.000Z",
  kind: "brief",
  questions: [],
  outcome: { stage: "approve", final: false, next: "Spec", done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] },
  stages: { list: [builtinStage("approve", [])], minButtonWidth: 160 },
};
const approved = { accepted: true };
const opus: Execution = { providerId: "claude-code", model: "opus", reasoningLevel: "high" };
const sonnet: Execution = { providerId: "claude-code", model: "sonnet", reasoningLevel: "medium", serviceTier: "fast" };
const codex: Execution = { providerId: "codex", model: "gpt-5-codex", reasoningLevel: "medium" };

const models = {
  providers: [{ id: "claude-code", available: true, displayName: "Claude Code" }, { id: "codex", available: true, displayName: "Codex" }],
  models: [{ model: "opus", displayName: "Opus", isDefault: true, defaultReasoningEffort: "high", supportedReasoningEfforts: [{ reasoningEffort: "high" }] }],
};

const setup = async (options: { failModels?: boolean } = {}) => {
  const updates: Array<Record<string, unknown>> = [];
  const spawned: Array<Record<string, unknown>> = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        get: async () => ({ id: "thr_1", projectId: "proj_1", environmentId: "env_1", status: "idle", providerId: "claude-code", title: "Тред", originPluginId: null }),
        defaultExecutionOptions: async () => ({ model: "opus", reasoningLevel: "high", serviceTier: "default", permissionMode: "auto", source: "client/turn/start" }),
        update: async (args: object) => void updates.push(args as Record<string, unknown>),
        send: async () => ({ delivery: "started" }),
        spawn: async (args: object) => {
          spawned.push(args as Record<string, unknown>);
          return { id: "thr_new" };
        },
      },
      providers: {
        models: async () => {
          if (options.failModels === true) throw new Error("offline");
          return models;
        },
      },
      environments: { get: async () => ({ hostId: "host_1", path: "/tree", branchName: "b", isWorktree: true }) },
    },
  });
  const store = createStore(bb.storage.kv);
  await store.putBrief(brief);
  registerApi(bb, store, {
    now: () => "2026-10-12T10:05:00.000Z",
    flowIds: () => ["bug", "bb"],
    switchFlow: async () => undefined,
    widgetFlows: () => [{ id: "bug", name: "Bug" }, { id: "bb", name: "BB Plugin", execution: sonnet }],
    threadFlowId: () => "bug",
  });
  return { harness, updates, spawned };
};

describe("ряд виджета на сервере", () => {
  it("каталог: модель треда, модели доступных провайдеров и flow владельца с их моделью", async () => {
    const { harness } = await setup();
    const catalog = (await harness.callRpc("widgetAgent", { threadId: "thr_1" })) as { current: Execution; currentFlowId: string | null; providers: Array<{ id: string; models: Array<{ name: string }> }>; flows: unknown[] };
    expect(catalog.current).toEqual(opus);
    expect(catalog.currentFlowId).toBe("bug");
    expect(catalog.providers.map((p) => p.id)).toEqual(["claude-code", "codex"]);
    expect(catalog.providers[0]!.models[0]!.name).toBe("Opus");
    expect(catalog.flows).toHaveLength(2);
  });

  it("сбой каталога — null, а не ошибка RPC", async () => {
    const { harness } = await setup({ failModels: true });
    expect(await harness.callRpc("widgetAgent", { threadId: "thr_1" })).toBeNull();
  });

  it("в этом треде модель и effort ставятся треду, flow — переходом", async () => {
    const { harness, updates } = await setup();
    const answer = { briefId: "dec_a", answers: [], outcome: approved, flow: { id: "bb", name: "BB Plugin" }, execution: sonnet };
    expect(await harness.callRpc("answerBrief", { id: "dec_a", answer, messageId: "m" })).toMatchObject({ kind: "accepted" });
    expect(updates).toEqual([{ threadId: "thr_1", model: "sonnet", reasoningLevel: "medium" }]);
  });

  it("другой провайдер в этом треде — отказ, ответ не записывается", async () => {
    const { harness, updates } = await setup();
    await expect(harness.callRpc("answerBrief", { id: "dec_a", answer: { briefId: "dec_a", answers: [], outcome: approved, execution: codex }, messageId: "m" })).rejects.toThrow(/another provider runs only in a new thread/);
    expect(updates).toEqual([]);
  });

  it("в новом треде другой провайдер уходит в spawn вместе с моделью", async () => {
    const { harness, spawned, updates } = await setup();
    const answer = { briefId: "dec_a", answers: [], outcome: approved, place: "thread" as const, execution: codex };
    expect(await harness.callRpc("answerBrief", { id: "dec_a", answer, messageId: "m" })).toMatchObject({ kind: "accepted", record: { handoffThreadId: "thr_new" } });
    expect(spawned[0]).toMatchObject({ providerId: "codex", model: "gpt-5-codex", reasoningLevel: "medium" });
    expect(updates).toEqual([]);
  });

  it("flow, которого у владельца нет, отвергается", async () => {
    const { harness } = await setup();
    await expect(harness.callRpc("answerBrief", { id: "dec_a", answer: { briefId: "dec_a", answers: [], outcome: approved, flow: { id: "ghost", name: "Ghost" } }, messageId: "m" })).rejects.toThrow(/which the owner does not have/);
  });
});

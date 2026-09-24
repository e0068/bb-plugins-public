// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createProgress } from "./progress";
import { createStore } from "./store";

const brief: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_src",
  title: "Flow — компактация перед ответом",
  createdAt: "2026-09-24T10:00:00.000Z",
  kind: "brief",
  questions: [],
  setup: { stages: [{ id: "implement", state: "todo", recommended: true, executor: "self" }] },
  stages: { list: [{ id: "implement", skill: "code", name: "Реализация", review: false, executors: [] }], minButtonWidth: 160 },
};

const answer = (extra: Partial<DecisionAnswer> = {}): DecisionAnswer => ({
  briefId: "dec_1",
  answers: [],
  stages: [{ id: "implement", run: true, executor: "self", review: false }],
  place: "here",
  ...extra,
});

const host = async (options: { failCompact?: boolean } = {}) => {
  const log: string[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        compact: async ({ threadId }: { threadId: string }) => {
          if (options.failCompact === true) throw new Error("compaction failed");
          log.push(`compact:${threadId}`);
          return { ok: true };
        },
        send: async ({ threadId }: { threadId: string }) => {
          log.push(`send:${threadId}`);
          return { delivery: "queued" };
        },
        get: async () => ({ projectId: "proj_1", environmentId: "env_1" }),
        spawn: async () => {
          log.push("spawn");
          return { id: "thr_new" };
        },
      },
      environments: { get: async () => ({ hostId: "host_1", path: "/tree", branchName: "bb/thr_src" }) },
    },
  });
  return { bb, harness, log, store: createStore(bb.storage.kv) };
};

const setup = async (options: { failCompact?: boolean } = {}) => {
  const { bb, harness, log, store } = await host(options);
  await store.putBrief(brief);
  registerApi(bb, store, { now: () => "2026-09-24T10:05:00.000Z" });
  const call = (input: unknown) => harness.callRpc("answerBrief", input);
  return { store, log, call };
};

describe("компактация перед ответом в этом треде", () => {
  it("сначала компактирует тред, потом ставит ответ в его очередь", async () => {
    const { log, call } = await setup();
    const result = await call({ id: "dec_1", answer: answer({ compact: true }), messageId: "msg_1" });
    expect((result as { kind: string }).kind).toBe("accepted");
    expect(log).toEqual(["compact:thr_src", "send:thr_src"]);
  });

  it("без выбора компактации тред не компактируется", async () => {
    const { log, call } = await setup();
    await call({ id: "dec_1", answer: answer(), messageId: "msg_1" });
    expect(log).toEqual(["send:thr_src"]);
  });

  it("компактирует и тогда, когда агенту реплика не нужна", async () => {
    // Принятая финальная Демонстрация без комментария: агенту делать нечего, реплика не уходит.
    const demo: DecisionBrief = {
      id: "dec_demo",
      threadId: "thr_src",
      title: "Демонстрация",
      createdAt: "2026-09-24T10:00:00.000Z",
      kind: "brief",
      questions: [],
      stages: { list: [stage("practice", { name: "Работа" }), stage("demo", { kind: "demo", skill: "", name: "Демонстрация" })], minButtonWidth: 170 },
      outcome: { stage: "demo", final: true, done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] },
    };
    const { harness, bb, store } = await host();
    await store.putBrief(demo);
    await bb.storage.kv.set("flow-progress:thr_src", { stages: { practice: { finishedAt: "2026-09-24T10:00:00.000Z" } }, waiting: ["demo"] });
    registerApi(bb, store, { now: () => "2026-09-24T10:05:00.000Z", progress: createProgress(bb.storage.kv) });
    const result = await harness.callRpc("answerBrief", { id: "dec_demo", answer: { briefId: "dec_demo", answers: [], outcome: { accepted: true }, place: "here", compact: true }, messageId: "m" });
    expect((result as { kind: string }).kind).toBe("accepted");
    expect(harness.sdk.callsTo("threads.compact")).toHaveLength(1);
    expect(harness.sdk.callsTo("threads.send")).toHaveLength(0);
  });

  it("сбой компактации ответ не принимает: реплики нет, повтор дойдёт", async () => {
    const { store, log, call } = await setup({ failCompact: true });
    await expect(call({ id: "dec_1", answer: answer({ compact: true }), messageId: "msg_1" })).rejects.toThrow();
    expect(log).toEqual([]);
    expect(await store.getAnswer("dec_1")).toBeNull();
  });

  it("компактация при новом треде отбивается до записи ответа", async () => {
    const { store, log, call } = await setup();
    await expect(call({ id: "dec_1", answer: answer({ place: "thread", compact: true }), messageId: "msg_1" })).rejects.toThrow();
    expect(log).toEqual([]);
    expect(await store.getAnswer("dec_1")).toBeNull();
  });
});

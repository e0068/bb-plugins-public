// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const brief: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_src",
  title: "Flow — место исполнения",
  createdAt: "2026-09-16T10:00:00.000Z",
  kind: "brief",
  questions: [],
  setup: { stages: [{ id: "implement", state: "todo", recommended: true, executor: "self" }] },
  stages: { list: [{ id: "implement", skill: "code", name: "Реализация", review: false, executors: [] }], minButtonWidth: 160 },
};

const answer = (place?: DecisionAnswer["place"], run = true): DecisionAnswer => ({
  briefId: "dec_1",
  answers: [],
  stages: [{ id: "implement", run, executor: "self", review: false }],
  ...(place === undefined ? {} : { place }),
});

const setup = async (options: { failSpawn?: boolean; failLaunchMark?: boolean } = {}) => {
  const sent: Array<Record<string, unknown>> = [];
  const spawned: Array<Record<string, unknown>> = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        send: async (args: unknown) => {
          sent.push(args as Record<string, unknown>);
          return { delivery: "started" };
        },
        get: async () => ({ projectId: "proj_1", environmentId: "env_1" }),
        spawn: async (args: unknown) => {
          if (options.failSpawn === true) throw new Error("host unavailable");
          spawned.push(args as Record<string, unknown>);
          return { id: "thr_new" };
        },
      },
      environments: { get: async () => ({ hostId: "host_1", path: "/tree", branchName: "bb/thr_src" }) },
    },
  });
  const real = createStore(bb.storage.kv);
  const store = options.failLaunchMark === true
    ? { ...real, markLaunched: async () => { throw new Error("kv unavailable"); } }
    : real;
  await store.putBrief(brief);
  registerApi(bb, store, { now: () => "2026-09-16T10:05:00.000Z" });
  const call = (input: unknown) => harness.callRpc("answerBrief", input);
  return { store, sent, spawned, harness, call };
};

describe("место исполнения при ответе", () => {
  it("«в этом треде» шлёт реплику в тот же тред и треда не создаёт", async () => {
    const { sent, spawned, call } = await setup();
    const result = await call({ id: "dec_1", answer: answer("here"), messageId: "msg_1" });
    expect((result as { kind: string }).kind).toBe("accepted");
    expect(sent).toHaveLength(1);
    expect(spawned).toHaveLength(0);
  });

  it("ответ без места ведёт себя как «в этом треде»", async () => {
    const { sent, spawned, call } = await setup();
    await call({ id: "dec_1", answer: answer(), messageId: "msg_1" });
    expect(sent).toHaveLength(1);
    expect(spawned).toHaveLength(0);
  });

  it("«новый тред» уводит ответ в созданный тред", async () => {
    const { sent, spawned, call } = await setup();
    const result = await call({ id: "dec_1", answer: answer("thread"), messageId: "msg_1" });
    expect((result as { kind: string; record: { handoffThreadId?: string } }).record.handoffThreadId).toBe("thr_new");
    expect(spawned).toHaveLength(1);
    expect(sent).toHaveLength(0);
  });

  it("ссылка на созданный тред остаётся в записи ответа", async () => {
    const { call, store } = await setup();
    await call({ id: "dec_1", answer: answer("thread"), messageId: "msg_1" });
    expect((await store.getAnswer("dec_1"))?.handoffThreadId).toBe("thr_new");
  });

  it("сбой передачи снимает запись ответа", async () => {
    const { call, store } = await setup({ failSpawn: true });
    await expect(call({ id: "dec_1", answer: answer("worktree"), messageId: "msg_1" })).rejects.toThrow();
    expect(await store.getAnswer("dec_1")).toBeNull();
  });
});

describe("частичный успех передачи", () => {
  it("созданный тред не теряет ответ, если отметка запуска не записалась", async () => {
    const { call, store, spawned } = await setup({ failLaunchMark: true });
    const result = await call({ id: "dec_1", answer: answer("thread"), messageId: "msg_1" });
    expect((result as { kind: string }).kind).toBe("accepted");
    expect(await store.getAnswer("dec_1")).not.toBeNull();
    expect(spawned).toHaveLength(1);
  });

  it("повтор после частичного успеха второй тред не создаёт", async () => {
    const { call, spawned } = await setup({ failLaunchMark: true });
    await call({ id: "dec_1", answer: answer("thread"), messageId: "msg_1" });
    const again = await call({ id: "dec_1", answer: answer("thread"), messageId: "msg_1" });
    expect((again as { kind: string }).kind).toBe("already_answered");
    expect(spawned).toHaveLength(1);
  });
});

describe("память места и отметка запуска", () => {
  it("выбор места помнится по проекту", async () => {
    const { call, store } = await setup();
    await call({ id: "dec_1", answer: answer("worktree"), messageId: "msg_1" });
    expect(await store.getPlace("proj_1")).toBe("worktree");
  });

  it("ответ без места память проекта не трогает", async () => {
    const { call, store } = await setup();
    await store.putPlace("proj_1", "worktree");
    await call({ id: "dec_1", answer: answer(), messageId: "msg_1" });
    expect(await store.getPlace("proj_1")).toBe("worktree");
  });

  it("ответ с этапами в прогоне помечает тред запущенным", async () => {
    const { call, store } = await setup();
    await call({ id: "dec_1", answer: answer("here"), messageId: "msg_1" });
    expect(await store.isLaunched("thr_src")).toBe(true);
  });

  it("ответ без этапов в прогоне тред не запускает", async () => {
    const { call, store } = await setup();
    await call({ id: "dec_1", answer: answer("here", false), messageId: "msg_1" });
    expect(await store.isLaunched("thr_src")).toBe(false);
  });

  it("тред, созданный передачей, запущен сразу", async () => {
    const { call, store } = await setup();
    await call({ id: "dec_1", answer: answer("thread", false), messageId: "msg_1" });
    expect(await store.isLaunched("thr_new")).toBe(true);
  });

  it("getDispatchPlace отдаёт последний выбор места в проекте", async () => {
    const { call, harness } = await setup();
    expect(await harness.callRpc("getDispatchPlace", { threadId: "thr_src" })).toEqual({ place: "here" });
    await call({ id: "dec_1", answer: answer("worktree"), messageId: "msg_1" });
    expect(await harness.callRpc("getDispatchPlace", { threadId: "thr_src" })).toEqual({ place: "worktree" });
  });

  it("ответ на бриф запущенной работы снимка прогноза не пишет", async () => {
    const { call, store } = await setup();
    await store.putBrief({ ...brief, id: "dec_run", launched: true, setup: { criteria: [{ text: "Тесты", add: { target: 1, max: 2, risk: 0 } }] }, stages: undefined });
    await call({ id: "dec_run", answer: { briefId: "dec_run", answers: [], criteria: { removed: [], edited: [], added: [] } }, messageId: "msg_1" });
    expect((await store.getAnswer("dec_run"))?.forecast).toBeUndefined();
  });
});

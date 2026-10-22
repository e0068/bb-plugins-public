// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const brief: DecisionBrief = {
  id: "dec_timeout",
  threadId: "thr_1",
  title: "Уточнение",
  createdAt: "2026-10-21T16:43:00.000Z",
  kind: "clarify",
  questions: [{ id: "ok", question: "Так?", kind: "yesno", allowOwn: false, options: [
    { id: "yes", action: "Да", recommended: true },
    { id: "no", action: "Нет", recommended: false },
  ] }],
};

const answer = { briefId: brief.id, answers: [{ questionId: "ok", optionIds: ["yes"] }] };

/** bb, чья отправка реплики падает данной ошибкой: дошла ли реплика, bb не знает. */
const setup = async (failure: Error) => {
  const sent: unknown[] = [];
  const warned: string[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        send: async (input: unknown) => {
          sent.push(input);
          throw failure;
        },
        get: async () => ({ id: "thr_1", projectId: "prj_1", environmentId: "env_1", title: "Тред" }),
      } as never,
    },
  });
  const store = createStore(bb.storage.kv);
  await store.putBrief(brief);
  registerApi(bb, store, { now: () => "2026-10-21T16:43:00.000Z", warn: (message) => warned.push(message) });
  return { harness, store, sent, warned };
};

describe("таймаут bb при отправке ответа агенту", () => {
  it("ответ остаётся принятым, и повтор из виджета не доставляет его агенту второй раз", async () => {
    const timeout = Object.assign(new Error("Timed out waiting for command result"), { code: "command_timeout" });
    const { harness, store, sent, warned } = await setup(timeout);
    expect(await harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer })).toMatchObject({ kind: "accepted" });
    expect(await harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer })).toMatchObject({ kind: "already_answered" });
    expect(sent).toHaveLength(1);
    expect(await store.getAnswer(brief.id)).not.toBeNull();
    expect(warned.join("\n")).toContain(brief.id);
  });

  it("отказ bb снимает ответ: повторная отправка доходит", async () => {
    const { harness, store, sent } = await setup(new Error("thread is archived"));
    await expect(harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer })).rejects.toThrow(/archived/);
    expect(await store.getAnswer(brief.id)).toBeNull();
    await expect(harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer })).rejects.toThrow(/archived/);
    expect(sent).toHaveLength(2);
  });
});

const timedOut = () => Object.assign(new Error("Timed out waiting for command result"), { code: "command_timeout" });

/** bb с заданными ответами SDK: шаги до доставки и сама доставка. */
const withSdk = async (sdk: Record<string, unknown>, stored: DecisionBrief = brief) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: sdk as never });
  const store = createStore(bb.storage.kv);
  await store.putBrief(stored);
  registerApi(bb, store, { now: () => "2026-10-21T16:43:00.000Z", warn: () => undefined });
  return { harness, store };
};

const thread = { id: "thr_1", projectId: "prj_1", environmentId: "env_1", title: "Тред", providerId: "claude-code" };

/** Бриф работы: его ответ можно увезти в новый тред, уточнение остаётся в своём. */
const work: DecisionBrief = { ...brief, id: "dec_work", kind: "brief" };
const workAnswer = { ...answer, briefId: work.id, place: "child" as const };

describe("таймаут bb до доставки ответа", () => {
  it("таймаут сжатия треда снимает ответ: агент его не получил, и повтор доходит", async () => {
    const sent: unknown[] = [];
    const { harness, store } = await withSdk({
      threads: {
        get: async () => ({ ...thread, status: "idle" }),
        compact: async () => {
          throw timedOut();
        },
        send: async (input: unknown) => {
          sent.push(input);
          return { delivery: "started" };
        },
      },
    });
    await expect(harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer: { ...answer, compact: true } })).rejects.toThrow(/Timed out/);
    expect(sent).toEqual([]);
    expect(await store.getAnswer(brief.id)).toBeNull();
  });

  it("таймаут шага перед созданием нового треда снимает ответ", async () => {
    const { harness, store } = await withSdk({
      threads: { get: async () => thread, spawn: async () => ({ id: "thr_new" }) },
      environments: {
        get: async () => {
          throw timedOut();
        },
      },
    }, work);
    await expect(harness.callRpc("answerBrief", { id: work.id, messageId: "msg_1", answer: workAnswer })).rejects.toThrow(/Timed out/);
    expect(await store.getAnswer(work.id)).toBeNull();
  });

  it("таймаут самого создания треда оставляет ответ принятым: повтор не открывает второй тред", async () => {
    let spawned = 0;
    const { harness, store } = await withSdk({
      threads: {
        get: async () => thread,
        spawn: async () => {
          spawned += 1;
          throw timedOut();
        },
      },
      environments: { get: async () => ({ hostId: "host_local", branchName: "bb/thr_1", path: "/w" }) },
    }, work);
    expect(await harness.callRpc("answerBrief", { id: work.id, messageId: "msg_1", answer: workAnswer })).toMatchObject({ kind: "accepted" });
    expect(await harness.callRpc("answerBrief", { id: work.id, messageId: "msg_1", answer: workAnswer })).toMatchObject({ kind: "already_answered" });
    expect(spawned).toBe(1);
    expect(await store.getAnswer(work.id)).not.toBeNull();
  });
});

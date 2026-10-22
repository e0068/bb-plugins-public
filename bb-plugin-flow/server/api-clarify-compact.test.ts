// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const clarify: DecisionBrief = {
  id: "dec_c",
  threadId: "thr_src",
  title: "Какой цвет взять?",
  createdAt: "2026-10-21T10:00:00.000Z",
  kind: "clarify",
  questions: [
    {
      id: "color",
      kind: "fork",
      question: "Какой цвет?",
      allowOwn: false,
      options: [
        { id: "red", action: "Красный", recommended: true, description: "Как в макете." },
        { id: "blue", action: "Синий", recommended: false, description: "Как в старой версии." },
      ],
    },
  ],
};

const answer = (extra: Partial<DecisionAnswer> = {}): DecisionAnswer => ({
  briefId: "dec_c",
  answers: [{ questionId: "color", optionIds: ["red"] }],
  place: "here",
  compact: true,
  ...extra,
});

const setup = async (status: "idle" | "active") => {
  const log: string[] = [];
  const modes: string[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        compact: async ({ threadId }: { threadId: string }) => {
          log.push(`compact:${threadId}`);
          return { ok: true };
        },
        send: async ({ threadId, mode }: { threadId: string; mode: string }) => {
          log.push(`send:${threadId}`);
          modes.push(mode);
          return { delivery: "queued" };
        },
        get: async () => ({ projectId: "proj_1", environmentId: "env_1", status }),
      },
    },
  });
  const store = createStore(bb.storage.kv);
  await store.putBrief(clarify);
  registerApi(bb, store, { now: () => "2026-10-21T10:05:00.000Z" });
  return { log, modes, call: (input: unknown) => harness.callRpc("answerBrief", input) };
};

describe("«Сжать тред» на уточнении", () => {
  it("агент закончил ход — тред сжимается до того, как ответ придёт агенту", async () => {
    const { log, call } = await setup("idle");
    const result = await call({ id: "dec_c", answer: answer(), messageId: "msg_1" });
    expect((result as { kind: string }).kind).toBe("accepted");
    expect(log).toEqual(["compact:thr_src", "send:thr_src"]);
  });

  it("агент ещё работает — ответ вливается в его ход без сжатия", async () => {
    const { log, call } = await setup("active");
    const result = await call({ id: "dec_c", answer: answer(), messageId: "msg_1" });
    expect((result as { kind: string }).kind).toBe("accepted");
    expect(log).toEqual(["send:thr_src"]);
  });

  it("ответ после сжатия встаёт в очередь, а не вливается в ход", async () => {
    const { modes, call } = await setup("idle");
    await call({ id: "dec_c", answer: answer(), messageId: "msg_1" });
    expect(modes).toEqual(["queue-if-active"]);
  });

  it("без выбора сжатия простаивающий тред не сжимается", async () => {
    const { log, call } = await setup("idle");
    await call({ id: "dec_c", answer: answer({ compact: undefined }), messageId: "msg_1" });
    expect(log).toEqual(["send:thr_src"]);
  });
});

describe("смена хода агента — открытым уточнениям", () => {
  it("начало, конец и сбой хода публикуются в канал хода с тредом", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    registerApi(bb, createStore(bb.storage.kv), { now: () => "2026-10-21T10:05:00.000Z" });
    const thread = (status: "active" | "idle" | "error") => ({ id: "thr_src", status }) as never;
    await harness.emitThreadEvent("thread.active", { thread: thread("active") });
    await harness.emitThreadEvent("thread.idle", { thread: thread("idle"), lastAssistantText: null });
    await harness.emitThreadEvent("thread.failed", { thread: thread("error"), error: null });
    expect(harness.realtimeSignals.filter((signal) => signal.channel === "decisions:turn").map((signal) => signal.payload)).toEqual([
      { threadId: "thr_src", turn: "running" },
      { threadId: "thr_src", turn: "ended" },
      { threadId: "thr_src", turn: "ended" },
    ]);
  });
});

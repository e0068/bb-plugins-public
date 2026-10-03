// @vitest-environment node
// Демонстрация с рекомендованным flow: «Отправить» с выбранным flow не закрывает Демонстрацию, а переводит тред
// (или новый тред) на этот flow. Автоматизации за Демонстрацией не идут, Automations ответа не видит.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const demo: DecisionBrief = {
  id: "dec_answer",
  threadId: "thr_src",
  title: "Ответ",
  createdAt: "2026-10-03T10:00:00.000Z",
  kind: "brief",
  questions: [],
  outcome: {
    stage: "demo",
    final: true,
    done: ["Ответ дан"],
    pending: [],
    results: [{ label: "a.md", target: "a.md" }],
    documentsOnly: true,
    nextFlow: "flow-bug",
  },
};

const switched = (place?: DecisionAnswer["place"], note?: string): DecisionAnswer => ({
  briefId: demo.id,
  answers: [],
  outcome: { accepted: false, flow: { id: "flow-bug", name: "Bug" }, ...(note === undefined ? {} : { note }) },
  ...(place === undefined ? {} : { place }),
});

const setup = async () => {
  const sent: Array<{ threadId: string; text: string }> = [];
  const order: string[] = [];
  const switches: string[][] = [];
  const handoffs: Array<Array<string | null>> = [];
  const recorded: string[] = [];
  const carried: string[][] = [];
  const emitted: unknown[][] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        compact: async () => void order.push("compact"),
        send: async (args: { threadId: string; input: Array<{ type: string; text?: string }> }) => {
          order.push("send");
          sent.push({ threadId: args.threadId, text: args.input.map((part) => part.text ?? "").join("") });
          return { delivery: "started" };
        },
        get: async () => ({ projectId: "proj_1", environmentId: "env_1" }),
        spawn: async () => ({ id: "thr_new" }),
      },
      environments: { get: async () => ({ hostId: "host_1", path: "/tree", branchName: "bb/thr_src" }) },
    },
  });
  const store = createStore(bb.storage.kv);
  await store.putBrief(demo);
  registerApi(bb, store, {
    now: () => "2026-10-03T10:05:00.000Z",
    emit: (...args) => void emitted.push(args),
    progress: {
      get: async () => null,
      recordAnswer: async (brief) => void recorded.push(brief.id),
      handOver: async (from, to) => void carried.push(["handOver", from, to]),
    },
    carryFlow: async (from, to) => void carried.push(["carryFlow", from, to]),
    switchFlow: async (threadId, flowId) => {
      order.push("switch");
      switches.push([threadId, flowId]);
    },
    releaseFlow: async (threadId) => void switches.push([threadId, "released"]),
    flowIds: () => ["flow-answer", "flow-bug"],
    handoffFlow: (sourceThreadId, flowId) => void handoffs.push([sourceThreadId, flowId]),
  });
  const call = (answer: DecisionAnswer) => harness.callRpc("answerBrief", { id: demo.id, answer, messageId: "m", locale: "ru" });
  return { sent, order, switches, handoffs, recorded, carried, emitted, call };
};

describe("переход в другой flow из Демонстрации", () => {
  it("«в этом треде» переводит тред на выбранный flow и будит агента", async () => {
    const t = await setup();
    await t.call(switched("here"));
    expect(t.switches).toEqual([["thr_src", "flow-bug"]]);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]?.threadId).toBe("thr_src");
    expect(t.sent[0]?.text).toContain("«Bug»");
  });

  it("Демонстрация не закрывается: прогон ответа не пишется, Automations не слышит ответа", async () => {
    const t = await setup();
    await t.call(switched("here"));
    expect(t.recorded).toEqual([]);
    expect(t.emitted).toEqual([]);
  });

  it("комментарий владельца едет агенту вместе с переходом", async () => {
    const t = await setup();
    await t.call(switched("here", "только первую находку"));
    expect(t.sent[0]?.text).toContain("только первую находку");
  });

  it("сжатие контекста идёт первым, потом переход, потом реплика", async () => {
    const t = await setup();
    await t.call({ ...switched("here"), compact: true });
    expect(t.order).toEqual(["compact", "switch", "send"]);
  });

  it("«в новом треде» отдаёт выбранный flow новому треду, а прогон ответа в исходном снимает", async () => {
    const t = await setup();
    await t.call(switched("child"));
    expect(t.handoffs).toEqual([["thr_src", "flow-bug"]]);
    expect(t.switches).toEqual([["thr_src", "released"]]);
    expect(t.carried).toEqual([]);
    expect(t.recorded).toEqual([]);
  });

  it("flow, которого у владельца нет, не принимается и ничего не трогает", async () => {
    const t = await setup();
    await expect(t.call({ ...switched("here"), outcome: { accepted: false, flow: { id: "flow-gone", name: "Gone" } } })).rejects.toThrow(/flow-gone/);
    expect(t.switches).toEqual([]);
    expect(t.sent).toEqual([]);
  });

  it("flow, которого демонстрация не предлагала, не принимается", async () => {
    const { outcome } = demo;
    if (outcome === undefined) throw new Error("demo brief without outcome");
    const plain: DecisionBrief = { ...demo, id: "dec_plain", outcome: { ...outcome, nextFlow: undefined } };
    const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
    const store = createStore(bb.storage.kv);
    await store.putBrief(plain);
    registerApi(bb, store, { now: () => "2026-10-03T10:05:00.000Z", switchFlow: async () => undefined });
    await expect(harness.callRpc("answerBrief", { id: plain.id, answer: { ...switched("here"), briefId: plain.id }, messageId: "m" })).rejects.toThrow(/flow/);
  });
});

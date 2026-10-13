// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief, PrototypeEdit } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const T = "2026-10-13T10:00:00.000Z";
const URL_ = "https://e0068--8766.getbb.app/sample.html";
const results = [{ label: "p", target: URL_ }];

const demo = (id: string): DecisionBrief => ({
  id,
  threadId: "thr_1",
  title: "Демонстрация",
  createdAt: T,
  kind: "brief",
  questions: [],
  outcome: { stage: "demo", final: false, next: "Approval", done: ["Прототип"], pending: [], results, prototype: { url: `${URL_}#top` } },
});
const approval = (id: string): DecisionBrief => ({
  id,
  threadId: "thr_1",
  title: "Утверждение",
  createdAt: T,
  kind: "brief",
  questions: [],
  stages: { list: [builtinStage("approve", [])], minButtonWidth: 160 },
  outcome: { stage: "approve", final: false, next: "Spec", done: ["Прототип"], pending: [], results },
});

const edit: PrototypeEdit = {
  forks: [{ id: "side", label: "Кнопка отправки", options: [{ value: "right", label: "Справа" }, { value: "left", label: "Слева" }] }],
  choices: { side: "left" },
  comments: [{ id: "c1", text: "Сделай кнопку синей", at: "кнопка «Отправить»" }],
};

const host = async () => {
  const sent: string[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: { threads: { send: async (args: { input: Array<{ type: string; text?: string }> }) => (sent.push(args.input.map((part) => ("text" in part ? (part.text ?? "") : "")).join("\n")), { delivery: "started" }) } },
  });
  const store = createStore(bb.storage.kv);
  registerApi(bb, store, { now: () => T });
  const call = (method: string, input: unknown) => harness.callRpc(method as never, input as never) as Promise<Record<string, unknown>>;
  const approve = (id: string) => call("answerBrief", { id, answer: { briefId: id, answers: [], outcome: { accepted: true } }, messageId: `m_${id}` });
  return { store, call, sent, approve };
};

describe("память прототипа и её доставка агенту", () => {
  it("выбор и комментарии переживают перезагрузку: виджет читает то, что записал", async () => {
    const { call } = await host();
    await call("savePrototype", { threadId: "thr_1", url: URL_, edit });
    const { state } = await call("getPrototype", { threadId: "thr_1", url: `${URL_}#other` });
    expect(state).toMatchObject({ choices: { side: "left" }, comments: [{ id: "c1" }] });
    expect(await call("getPrototype", { threadId: "thr_2", url: URL_ })).toEqual({ state: null });
  });

  it("ответ на утверждение несёт выбор и комментарии прототипа своей группы, а следующее утверждение их не повторяет", async () => {
    const { store, call, sent, approve } = await host();
    for (const brief of [demo("dec_demo"), approval("dec_ok"), demo("dec_demo2"), approval("dec_ok2")]) await store.putBrief(brief);
    await store.putApprovalGroup("dec_ok", ["dec_demo", "dec_ok"]);
    await store.putApprovalGroup("dec_ok2", ["dec_demo2", "dec_ok2"]);
    await call("savePrototype", { threadId: "thr_1", url: URL_, edit });

    await approve("dec_ok");
    expect(sent[0]).toContain("Выбор в прототипе:\n- Кнопка отправки — Слева");
    expect(sent[0]).toContain("Комментарии к прототипу:\n- кнопка «Отправить» — Сделай кнопку синей");

    await approve("dec_ok2");
    expect(sent[1]).not.toContain("Выбор в прототипе");
    expect(sent[1]).not.toContain("Комментарии к прототипу");
    const { state } = await call("getPrototype", { threadId: "thr_1", url: URL_ });
    expect(state).toMatchObject({ sentChoices: { side: "left" }, comments: [{ id: "c1", sent: true }] });
  });

  it("правка виджета после отправки не снимает отметки отправки", async () => {
    const { store, call, approve } = await host();
    for (const brief of [demo("dec_demo"), approval("dec_ok")]) await store.putBrief(brief);
    await store.putApprovalGroup("dec_ok", ["dec_demo", "dec_ok"]);
    await call("savePrototype", { threadId: "thr_1", url: URL_, edit });
    await approve("dec_ok");
    const { state } = await call("savePrototype", { threadId: "thr_1", url: URL_, edit: { ...edit, comments: [] } });
    expect(state).toMatchObject({ sentChoices: { side: "left" }, comments: [{ id: "c1", sent: true }] });
  });
});

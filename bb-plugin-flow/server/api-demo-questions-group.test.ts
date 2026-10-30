// @vitest-environment node
// Вопрос по демо: ответ на него уходит с Утверждением группы и ложится, как ответ брифа; комментарий демо — пунктом чек-листа.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const T = "2026-10-29T10:00:00.000Z";
const THREAD = "thr_1";

const stages = { list: [builtinStage("demo", []), builtinStage("approve", [])], minButtonWidth: 160 };
const fork = { id: "bevel", kind: "fork" as const, question: "Чинить фаску?", allowOwn: false, options: [{ id: "fix", action: "Чинить", description: "Да.", recommended: true }, { id: "keep", action: "Оставить", description: "Нет.", recommended: false }] };
const outcome = (stage: "demo" | "approve") => ({ stage, final: false, next: "Дальше", done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] });
const demo: DecisionBrief = { id: "D", threadId: THREAD, title: "Демонстрация", createdAt: T, kind: "brief", questions: [fork], stages, settle: "approval", outcome: outcome("demo") };
const approval: DecisionBrief = { id: "A", threadId: THREAD, title: "Утверждение", createdAt: T, kind: "brief", questions: [], stages, outcome: outcome("approve") };

const proceed = { briefId: "A", answers: [], outcome: { accepted: true } };
const answerOf = (optionId: string, note?: string) => ({ briefId: "D", answers: [{ questionId: "bevel", optionIds: [optionId] }], ...(note === undefined ? {} : { note }) });

const host = async () => {
  const sent: string[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: { threads: { send: async (args) => (sent.push(args.input.map((part) => ("text" in part ? part.text : "")).join("\n")), { delivery: "started" }) } },
  });
  const store = createStore(bb.storage.kv);
  for (const brief of [demo, approval]) await store.putBrief(brief);
  await store.putThreadGroup(THREAD, { ids: ["D", "A"], lastApprove: true, folded: false });
  await store.putApprovalGroup("A", ["D", "A"]);
  registerApi(bb, store, { now: () => T });
  const call = (method: string, input: unknown) => harness.callRpc(method as never, input as never) as Promise<Record<string, unknown>>;
  return { store, call, sent };
};

describe("демонстрация с вопросом в группе Утверждения", () => {
  it("она в группе и отдаёт вопрос вместе с итогом", async () => {
    const { call } = await host();
    const members = (await call("approvalMembers", { id: "A" })).members as DecisionBrief[];
    expect(members.map((b) => b.id)).toEqual(["D"]);
    expect(members[0]?.questions.map((q) => q.id)).toEqual(["bevel"]);
  });

  it("«Продолжить»: ответ на вопрос демо ложится из черновика и уходит агенту в реплике", async () => {
    const { call, store, sent } = await host();
    expect(await call("answerBrief", { id: "A", answer: proceed, messageId: "m", group: [{ id: "D", answer: answerOf("keep") }] })).toMatchObject({ kind: "accepted" });
    expect((await store.getAnswer("D"))?.answer).toEqual(answerOf("keep"));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Чинить фаску?");
  });

  it("комментарий демо с вопросом — пункт чек-листа под ответом Утверждения", async () => {
    const { call, store } = await host();
    await call("answerBrief", { id: "A", answer: proceed, messageId: "m", group: [{ id: "D", answer: answerOf("fix", "проверь тёмную тему") }] });
    expect(await store.getChecklist(THREAD)).toEqual({ approvalId: "A", items: [{ id: "c1", where: "Демонстрация", text: "проверь тёмную тему", done: false }] });
  });

  it("Утверждение без ответа демо на вопрос отбивается: правки не теряются молча", async () => {
    const { call } = await host();
    await expect(call("answerBrief", { id: "A", answer: proceed, messageId: "m", group: [{ id: "D" }] })).rejects.toThrow(/carries no answers of its group widgets D/);
  });
});

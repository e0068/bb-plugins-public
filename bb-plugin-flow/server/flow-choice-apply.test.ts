// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { NO_FLOW } from "../core/flows";
import { tellApplied } from "./flow-applied";
import { registerFlowChoice } from "./flow-choice";
import { createFlowSettings } from "./flow-settings";
import { createProgress } from "./progress";
import { createStore } from "./store";
import { createThreadFlows } from "./thread-flows";

const THREAD = "thr_apply";

const host = async (finished = false) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const flows = await createFlowSettings(bb.storage.kv);
  const base = flows.current();
  await flows.save({ ...base, flows: [...base.flows, { ...base.flows[0]!, id: "flow-bug", name: "Bug", stages: base.flows[0]!.stages.slice(0, 2) }] });
  const threads = await createThreadFlows(bb.storage.kv);
  const progress = createProgress(bb.storage.kv);
  const store = createStore(bb.storage.kv);
  const told: Array<{ threadId: string; flowId: string }> = [];
  registerFlowChoice(bb, {
    flows,
    threads,
    progress,
    store,
    cancelRun: () => undefined,
    finished: async () => finished,
    applied: async (threadId, flowId) => void told.push({ threadId, flowId }),
  });
  const call = (method: string, input: object = {}) => harness.callRpc(method, { threadId: THREAD, ...input });
  return { threads, progress, told, call, store };
};

describe("«Применить» у строки выбора flow", () => {
  it("строка знает flow треда: «Применить» видна, только когда выбор от него отличается", async () => {
    const { threads, call } = await host();
    await threads.assign(THREAD, NO_FLOW);
    expect(await call("threadFlowChoice")).toMatchObject({ selected: NO_FLOW, current: NO_FLOW });
    await call("pickThreadFlow", { flowId: "flow-bug" });
    expect(await call("threadFlowChoice")).toMatchObject({ selected: "flow-bug", current: NO_FLOW });
  });

  it("отдаёт выбор треду сразу, без сообщения: пустой прогон, выбор снят, агенту — строка", async () => {
    const { threads, progress, told, call } = await host();
    await threads.assign(THREAD, NO_FLOW);
    await call("pickThreadFlow", { flowId: "flow-bug" });
    expect(await call("applyThreadFlow")).toEqual({ kind: "applied", flowId: "flow-bug" });
    expect(threads.flowOf(THREAD)).toBe("flow-bug");
    expect(threads.pickedOf(THREAD)).toBeUndefined();
    expect(await progress.run(THREAD)).not.toBeNull();
    expect(told).toEqual([{ threadId: THREAD, flowId: "flow-bug" }]);
  });

  it("чек-лист прошлого прогона снимается вместе с ним: новый прогон он не держит", async () => {
    const { threads, store, call } = await host();
    await threads.assign(THREAD, NO_FLOW);
    await store.putChecklist(THREAD, { approvalId: "A", items: [{ id: "c1", where: "Вопросы", text: "x", done: false }] });
    await call("pickThreadFlow", { flowId: "flow-bug" });
    await call("applyThreadFlow");
    expect(await store.getChecklist(THREAD)).toBeNull();
    await store.putChecklist(THREAD, { approvalId: "A", items: [] });
    await call("cancelFlow");
    expect(await store.getChecklist(THREAD)).toBeNull();
  });

  it("без выбора нечего применять — тред не меняется", async () => {
    const { threads, told, call } = await host();
    await threads.assign(THREAD, NO_FLOW);
    expect(await call("applyThreadFlow")).toEqual({ kind: "failed", reason: "nothing-picked" });
    expect(threads.flowOf(THREAD)).toBe(NO_FLOW);
    expect(told).toEqual([]);
  });

  it("у идущего прогона строки выбора нет — применить нельзя, выбор остаётся ждать", async () => {
    const { threads, progress, call } = await host();
    await threads.assign(THREAD, "flow-bug");
    await progress.annotate(THREAD, (p) => p);
    await threads.pick(THREAD, NO_FLOW);
    expect(await call("applyThreadFlow")).toEqual({ kind: "failed", reason: "running" });
    expect(threads.pickedOf(THREAD)).toBe(NO_FLOW);
  });

  it("завершённый прогон уступает применённому flow", async () => {
    const { threads, progress, call } = await host(true);
    await threads.assign(THREAD, "flow-bug");
    await progress.annotate(THREAD, (p) => ({ ...p, stages: { done: { startedAt: "2026-10-01T10:00:00.000Z", finishedAt: "2026-10-01T10:01:00.000Z" } } }));
    await call("pickThreadFlow", { flowId: NO_FLOW });
    expect(await call("applyThreadFlow")).toEqual({ kind: "applied", flowId: NO_FLOW });
    expect(threads.flowOf(THREAD)).toBe(NO_FLOW);
    expect(await progress.run(THREAD)).toBeNull();
  });
});

describe("строка агенту после «Применить»", () => {
  const stages = [{ id: "spec", kind: "skill" as const, skill: "spec", name: "Spec", executors: [] }];
  const make = (active: boolean) => {
    const sent: Array<{ threadId: string; input: Array<{ text: string; visibility?: string }> }> = [];
    const marked: string[] = [];
    const tell = tellApplied({
      active: async () => active,
      steer: async (threadId, input) => void sent.push({ threadId, input }),
      mark: (_, text) => void marked.push(text),
      flowOf: (flowId) => (flowId === "flow-bug" ? { name: "Bug", stages } : null),
      isNoFlow: (flowId) => flowId === NO_FLOW,
    });
    return { tell, sent, marked };
  };

  it("агент в ходе получает подпись для владельца и этапы нового flow только для себя", async () => {
    const { tell, sent, marked } = make(true);
    await tell(THREAD, "flow-bug", "ru");
    expect(sent).toHaveLength(1);
    const [visible, service] = sent[0]!.input;
    expect(visible).toMatchObject({ text: "Flow «Bug» применён посреди хода" });
    expect(visible!.visibility).toBeUndefined();
    expect(service).toMatchObject({ visibility: "agent-only" });
    expect(service!.text).toContain('applied the flow "Bug"');
    expect(service!.text).toContain('spec "Spec"');
    expect(marked).toEqual(["Flow «Bug» применён посреди хода"]);
  });

  it("тред без хода ничего не получает: этапы придут со следующим ходом", async () => {
    const { tell, sent } = make(false);
    await tell(THREAD, "flow-bug", "ru");
    expect(sent).toEqual([]);
  });

  it("«Без flow» посреди хода — строка, что этапов больше нет", async () => {
    const { tell, sent } = make(true);
    await tell(THREAD, NO_FLOW, "en");
    expect(sent[0]!.input[0]).toMatchObject({ text: 'Flow "No flow" applied mid-turn' });
    expect(sent[0]!.input[1]!.text).toContain("no flow");
  });

  it("«Автоматически» посреди хода агенту не сообщается", async () => {
    const { tell, sent } = make(true);
    await tell(THREAD, "auto", "ru");
    expect(sent).toEqual([]);
  });
});

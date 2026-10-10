// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { AGENT_NO_FLOW, AUTO_FLOW, NO_FLOW } from "../core/flows";
import { registerFlowChoice } from "./flow-choice";
import { createFlowSettings } from "./flow-settings";
import { createProgress } from "./progress";
import { createStore } from "./store";
import { createThreadFlows } from "./thread-flows";

const THREAD = "thr_choice";
const AT = "2026-10-01T10:00:00.000Z";

const host = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const flows = await createFlowSettings(bb.storage.kv);
  const base = flows.current();
  await flows.save({ ...base, flows: [...base.flows, { ...base.flows[0]!, id: "flow-bug", name: "Bug", stages: base.flows[0]!.stages.slice(0, 2) }] });
  const threads = await createThreadFlows(bb.storage.kv);
  const progress = createProgress(bb.storage.kv);
  const store = createStore(bb.storage.kv);
  const cancelled: string[] = [];
  const choice = registerFlowChoice(bb, { flows, threads, progress, store, cancelRun: (threadId) => void cancelled.push(threadId) });
  const call = (method: string, input: object) => harness.callRpc(method, { threadId: THREAD, ...input });
  return { flows, threads, progress, store, cancelled, choice, call };
};

describe("строка выбора flow над композером", () => {
  it("список: flow владельца с числом этапов; выбранным стоит flow треда", async () => {
    const { flows, threads, call } = await host();
    await threads.assign(THREAD, "flow-bug");
    const answer = (await call("threadFlowChoice", {})) as { flows: Array<{ id: string; name: string; stages: number }>; selected: string };
    expect(answer.flows).toEqual(flows.current().flows.map((flow) => ({ id: flow.id, name: flow.name, stages: flow.stages.length })));
    expect(answer.selected).toBe("flow-bug");
  });

  it("строка «Flow» считается этапами вложенного flow, а удалённый вложенный flow — нулём", async () => {
    const { flows, call } = await host();
    const base = flows.current();
    const nested = { id: "nested-flow", kind: "skill" as const, skill: "", name: "Bug", executors: [], flowId: "flow-bug" };
    const gone = { ...nested, id: "gone", flowId: "missing" };
    await flows.save({ ...base, flows: [...base.flows, { id: "flow-outer", name: "Outer", stages: [nested, gone] }] });
    const answer = (await call("threadFlowChoice", {})) as { flows: Array<{ id: string; stages: number }> };
    expect(answer.flows.find((f) => f.id === "flow-outer")?.stages).toBe(2);
  });

  it("тред, оставленный агентом без flow, показан как «Автоматически»: агент ещё может выбрать flow", async () => {
    const { threads, call } = await host();
    await threads.assign(THREAD, AGENT_NO_FLOW);
    expect(await call("threadFlowChoice", {})).toMatchObject({ selected: AUTO_FLOW });
  });

  it("«Без flow» владельца в треде, оставленном агентом без flow, запоминается как запрет", async () => {
    const { threads, call } = await host();
    await threads.assign(THREAD, AGENT_NO_FLOW);
    await call("pickThreadFlow", { flowId: NO_FLOW });
    expect(threads.pickedOf(THREAD)).toBe(NO_FLOW);
  });

  it("тред без привязки идёт по flow по умолчанию — он и выбран", async () => {
    const { flows, call } = await host();
    expect(await call("threadFlowChoice", {})).toMatchObject({ selected: flows.current().flows[0]!.id });
  });

  it("выбор запоминается и виден выбранным, но flow треду не назначает", async () => {
    const { threads, call } = await host();
    await threads.assign(THREAD, NO_FLOW);
    expect(await call("pickThreadFlow", { flowId: "flow-bug" })).toEqual({ kind: "picked", selected: "flow-bug" });
    expect(await call("threadFlowChoice", {})).toMatchObject({ selected: "flow-bug" });
    expect(threads.flowOf(THREAD)).toBe(NO_FLOW);
  });

  it("«Автоматически» и «Flow не выбран» принимаются наравне с flow", async () => {
    const { threads, call } = await host();
    await threads.assign(THREAD, "flow-bug");
    expect(await call("pickThreadFlow", { flowId: AUTO_FLOW })).toEqual({ kind: "picked", selected: AUTO_FLOW });
    expect(await call("pickThreadFlow", { flowId: NO_FLOW })).toEqual({ kind: "picked", selected: NO_FLOW });
  });

  it("выбор того же, что у треда, снимает запомненный", async () => {
    const { threads, call } = await host();
    await threads.assign(THREAD, NO_FLOW);
    await call("pickThreadFlow", { flowId: "flow-bug" });
    expect(await call("pickThreadFlow", { flowId: NO_FLOW })).toEqual({ kind: "picked", selected: NO_FLOW });
    expect(threads.pickedOf(THREAD)).toBeUndefined();
  });

  it("неизвестный flow отбивается, выбор не меняется", async () => {
    const { threads, call } = await host();
    await threads.assign(THREAD, NO_FLOW);
    expect(await call("pickThreadFlow", { flowId: "flow-gone" })).toEqual({ kind: "failed", reason: "unknown-flow" });
    expect(threads.pickedOf(THREAD)).toBeUndefined();
  });
});

describe("выбор применяется, когда владелец начинает ход", () => {
  it("flow достаётся треду, и заводится пустой прогон — над композером встаёт бар", async () => {
    const { threads, progress, choice, call } = await host();
    await threads.assign(THREAD, NO_FLOW);
    await call("pickThreadFlow", { flowId: "flow-bug" });
    await choice.ownerTurn(THREAD);
    expect(threads.flowOf(THREAD)).toBe("flow-bug");
    expect(threads.pickedOf(THREAD)).toBeUndefined();
    expect(await progress.get(THREAD)).toMatchObject({ stages: {}, waiting: [] });
  });

  it("«Автоматически» назначается без прогона: flow выберет агент", async () => {
    const { threads, progress, choice, call } = await host();
    await threads.assign(THREAD, NO_FLOW);
    await call("pickThreadFlow", { flowId: AUTO_FLOW });
    await choice.ownerTurn(THREAD);
    expect(threads.flowOf(THREAD)).toBe(AUTO_FLOW);
    expect(await progress.get(THREAD)).toBeNull();
  });

  it("без выбора ход ничего не меняет", async () => {
    const { threads, progress, choice } = await host();
    await threads.assign(THREAD, NO_FLOW);
    await choice.ownerTurn(THREAD);
    expect(threads.flowOf(THREAD)).toBe(NO_FLOW);
    expect(await progress.get(THREAD)).toBeNull();
  });
});

describe("«Отменить flow»", () => {
  it("тред идёт без flow, прогон снят, автоповторы погашены, ожидание владельца снято", async () => {
    const { threads, progress, store, cancelled, call } = await host();
    await threads.assign(THREAD, "flow-bug");
    await progress.update(THREAD, () => ({ stages: { questions: { startedAt: AT } }, waiting: [] }));
    await store.putAwaiting(THREAD, { briefId: "automation:land", kind: "automation" });
    expect(await call("cancelFlow", {})).toEqual({ kind: "cancelled" });
    expect(threads.flowOf(THREAD)).toBe(NO_FLOW);
    expect(await progress.get(THREAD)).toBeNull();
    expect(cancelled).toEqual([THREAD]);
    expect(await store.listAwaiting()).toEqual([]);
  });

  it("запомненный выбор тоже снимается", async () => {
    const { threads, call } = await host();
    await threads.assign(THREAD, "flow-bug");
    await threads.pick(THREAD, AUTO_FLOW);
    await call("cancelFlow", {});
    expect(threads.pickedOf(THREAD)).toBeUndefined();
  });
});

describe("flow треда для страницы Flow", () => {
  it("тред, идущий flow, отдаёт его", async () => {
    const { threads, call } = await host();
    await threads.assign(THREAD, "flow-bug");
    expect(await call("threadFlow", {})).toEqual({ flowId: "flow-bug" });
  });

  it("завершённый прогон не отнимает у треда его flow", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    const flows = await createFlowSettings(bb.storage.kv);
    const threads = await createThreadFlows(bb.storage.kv);
    registerFlowChoice(bb, { flows, threads, progress: createProgress(bb.storage.kv), store: createStore(bb.storage.kv), cancelRun: () => undefined, finished: async () => true });
    const flowId = flows.current().flows[0]!.id;
    await threads.assign(THREAD, flowId);
    expect(await harness.callRpc("threadFlow", { threadId: THREAD })).toEqual({ flowId });
  });

  it("без своего flow — «Автоматически», отказ агента, «Без flow», удалённый flow — null", async () => {
    const { threads, call } = await host();
    for (const flowId of [AUTO_FLOW, AGENT_NO_FLOW, NO_FLOW, "flow-gone"]) {
      await threads.assign(THREAD, flowId);
      expect(await call("threadFlow", {})).toEqual({ flowId: null });
    }
  });
});

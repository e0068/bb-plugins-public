// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { NO_FLOW } from "../core/flows";
import { registerFlowChoice } from "./flow-choice";
import { createFlowSettings } from "./flow-settings";
import { createProgress } from "./progress";
import { createStore } from "./store";
import { createThreadFlows } from "./thread-flows";

const THREAD = "thr_live";
const AT = "2026-10-01T10:00:00.000Z";

const host = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const flows = await createFlowSettings(bb.storage.kv);
  const base = flows.current();
  await flows.save({ ...base, flows: [...base.flows, { ...base.flows[0]!, id: "flow-bug", name: "Bug" }] });
  const threads = await createThreadFlows(bb.storage.kv);
  const progress = createProgress(bb.storage.kv);
  const cancelled: string[] = [];
  const choice = registerFlowChoice(bb, { flows, threads, progress, store: createStore(bb.storage.kv), cancelRun: (threadId) => void cancelled.push(threadId) });
  return { harness, threads, progress, choice, cancelled, defaultId: base.flows[0]!.id };
};

describe("выбор над композером не перебивает прогон, начатый без него", () => {
  it("прогон появился после выбора — сообщение владельца flow не меняет, а выбор снимает", async () => {
    const { threads, progress, choice, defaultId } = await host();
    await threads.assign(THREAD, defaultId);
    await threads.pick(THREAD, "flow-bug");
    await progress.update(THREAD, () => ({ stages: { questions: { startedAt: AT } }, waiting: [] }));
    await choice.ownerTurn(THREAD);
    expect(threads.flowOf(THREAD)).toBe(defaultId);
    expect(threads.pickedOf(THREAD)).toBeUndefined();
  });
});

describe("«Отменить flow» из треда, который прогон только видит", () => {
  it("отбивается: flow, запись и автоматизации носителя не тронуты", async () => {
    const { harness, threads, progress, cancelled, defaultId } = await host();
    await threads.assign(THREAD, defaultId);
    await progress.update(THREAD, () => ({ stages: { questions: { startedAt: AT } }, waiting: [] }));
    await progress.handOver(THREAD, "thr_new", []);
    expect(await harness.callRpc("cancelFlow", { threadId: THREAD })).toEqual({ kind: "failed", reason: "carried" });
    expect(threads.flowOf(THREAD)).toBe(defaultId);
    expect(await progress.get("thr_new")).not.toBeNull();
    expect(cancelled).toEqual([]);
    expect(threads.flowOf(THREAD)).not.toBe(NO_FLOW);
  });
});

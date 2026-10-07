// @vitest-environment node
// Иконка flow доезжает до композера: кнопка flow нового треда и строка выбора над композером треда получают её в списке flow.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { Flow, WorkStage } from "../shared/contract";
import { registerFlowChoice } from "./flow-choice";
import { registerFlowPickerApi } from "./flow-picker-api";
import { createFlowSettings } from "./flow-settings";
import { createProgress } from "./progress";
import { createStore } from "./store";
import { createThreadFlows } from "./thread-flows";

const skill = (id: string): WorkStage => ({ id, kind: "skill", skill: "code", name: id, executors: [] });
/** Flow с иконкой: поле `icon` появляется в схеме подзадачей data. */
const withIcon = (f: Flow, icon: string) => ({ ...f, icon }) as Flow;
const rocket = withIcon({ id: "flow-rocket", name: "Rocket flow", stages: [skill("a"), skill("b")] }, "Rocket");
const plain: Flow = { id: "flow-plain", name: "Plain", stages: [skill("c")] };

const host = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const flows = await createFlowSettings(bb.storage.kv);
  await flows.save({ ...flows.current(), flows: [rocket, plain] });
  const threads = await createThreadFlows(bb.storage.kv);
  registerFlowPickerApi(bb, flows, threads);
  registerFlowChoice(bb, { flows, threads, progress: createProgress(bb.storage.kv), store: createStore(bb.storage.kv), cancelRun: () => undefined });
  return harness;
};

type Listed = { flows: Array<Record<string, unknown>> };

describe("иконка flow в RPC композера", () => {
  it("getFlowChoice отдаёт иконку flow", async () => {
    const harness = await host();
    const answer = (await harness.callRpc("getFlowChoice", { projectId: "proj_a" })) as Listed;
    expect(answer.flows[0]).toEqual({ id: "flow-rocket", name: "Rocket flow", icon: "Rocket" });
  });

  it("threadFlowChoice отдаёт иконку flow", async () => {
    const harness = await host();
    const answer = (await harness.callRpc("threadFlowChoice", { threadId: "thr_icon" })) as Listed;
    expect(answer.flows[0]).toEqual({ id: "flow-rocket", name: "Rocket flow", stages: 2, icon: "Rocket" });
  });

  it("flow без иконки приходит без поля", async () => {
    const harness = await host();
    const picker = (await harness.callRpc("getFlowChoice", { projectId: "proj_a" })) as Listed;
    const choice = (await harness.callRpc("threadFlowChoice", { threadId: "thr_icon" })) as Listed;
    expect(picker.flows).toStrictEqual([
      { id: "flow-rocket", name: "Rocket flow", icon: "Rocket" },
      { id: "flow-plain", name: "Plain" },
    ]);
    expect(choice.flows).toStrictEqual([
      { id: "flow-rocket", name: "Rocket flow", stages: 2, icon: "Rocket" },
      { id: "flow-plain", name: "Plain", stages: 1 },
    ]);
  });
});

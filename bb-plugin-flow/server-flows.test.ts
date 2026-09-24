// @vitest-environment node
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { addFlow, DEFAULT_STAGES, newFlow, NO_FLOW, setFlowStages } from "./core/flows";
import plugin from "./server";

const text = (result: unknown) => (typeof result === "string" ? result : JSON.stringify(result));
const todo = (ids: readonly string[]) => ids.map((id) => ({ id, state: "todo" }));
const DEFAULT_IDS = DEFAULT_STAGES.map((s) => s.id);

/** Плагин с двумя flow: Default по умолчанию и Quick из двух этапов. */
const withQuick = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  await plugin(bb);
  const settings = await harness.callRpc<{ flows: { id: string }[]; minButtonWidth: number }>("getFlowSettings", {});
  const quick = setFlowStages(addFlow(settings as never, newFlow("quick", "Quick")), "quick", (stages) => stages.filter((s) => s.id === "criteria" || s.id === "implement"));
  await harness.callRpc("saveFlowSettings", quick);
  return { harness };
};

describe("плагин Flow: flow и треды", () => {
  it("из штатных настроек — язык и два порога второй полосы; RPC страницы Flow и выбора flow зарегистрированы, старых RPC этапов нет", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    await plugin(bb);
    expect(Object.keys(harness.registrations.settingsDescriptors)).toEqual(["language", "contextWarnPercent", "contextAlertPercent"]);
    expect(harness.registrations.settingsDescriptors.contextWarnPercent).toMatchObject({ type: "number", default: 25 });
    expect(harness.registrations.settingsDescriptors.contextAlertPercent).toMatchObject({ type: "number", default: 40 });
    expect(harness.registrations.rpcMethods).toEqual(expect.arrayContaining(["getFlowSettings", "saveFlowSettings", "getStageCatalog", "getFlowChoice", "setFlowChoice"]));
    expect(harness.registrations.rpcMethods).not.toContain("getStageSettings");
  });

  it("бриф с этапами flow по умолчанию проходит инструмент в треде без выбора", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    await plugin(bb);
    expect(text(await harness.callAgentTool("ask_decision", { title: "Бриф", setup: { stages: todo(DEFAULT_IDS) } }, { threadId: "thr_old" }))).toMatch(/::decision\{id="dec_/);
  });

  it("тред, созданный после выбора flow в композере, получает его этапы в инструкциях и в проверке брифа", async () => {
    const { harness } = await withQuick();
    expect(await harness.callRpc("setFlowChoice", { projectId: "proj_a", flowId: "quick" })).toEqual({ selected: "quick" });
    await harness.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "thr_new", projectId: "proj_a", parentThreadId: null }) });
    const instructions = harness.registrations.instructionProvider?.({ threadId: "thr_new", projectId: "proj_a" }) ?? "";
    expect(instructions).toMatch(/1\. criteria/);
    expect(instructions).toMatch(/2\. implement/);
    expect(instructions).not.toMatch(/prototype/);
    expect(text(await harness.callAgentTool("ask_decision", { title: "Бриф", setup: { stages: todo(["criteria", "implement"]) } }, { threadId: "thr_new" }))).toMatch(/::decision\{id="dec_/);
    expect(text(await harness.callAgentTool("ask_decision", { title: "Бриф", setup: { stages: todo(DEFAULT_IDS) } }, { threadId: "thr_new" }))).toMatch(/criteria, implement/);
  });

  it("выбор проекта читается кнопкой: список flow и выбранный; без выбора — flow по умолчанию", async () => {
    const { harness } = await withQuick();
    expect(await harness.callRpc("getFlowChoice", { projectId: "proj_a" })).toEqual({ flows: [{ id: "default", name: "Default" }, { id: "quick", name: "Quick" }], selected: "default" });
    await harness.callRpc("setFlowChoice", { projectId: "proj_a", flowId: "quick" });
    expect(await harness.callRpc("getFlowChoice", { projectId: "proj_a" })).toMatchObject({ selected: "quick" });
  });

  it("запись неизвестного flow отвергается", async () => {
    const { harness } = await withQuick();
    await expect(harness.callRpc("setFlowChoice", { projectId: "proj_a", flowId: "gone" })).rejects.toThrow();
  });

  it("«без flow» записывается выбором проекта и читается кнопкой", async () => {
    const { harness } = await withQuick();
    expect(await harness.callRpc("setFlowChoice", { projectId: "proj_a", flowId: NO_FLOW })).toEqual({ selected: NO_FLOW });
    expect(await harness.callRpc("getFlowChoice", { projectId: "proj_a" })).toEqual({ flows: [{ id: "default", name: "Default" }, { id: "quick", name: "Quick" }], selected: NO_FLOW });
  });

  it("тред, созданный при выборе «без flow», не получает от Flow ни правила, ни этапов", async () => {
    const { harness } = await withQuick();
    await harness.callRpc("setFlowChoice", { projectId: "proj_a", flowId: NO_FLOW });
    await harness.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "thr_none", projectId: "proj_a", parentThreadId: null }) });
    expect(harness.registrations.instructionProvider?.({ threadId: "thr_none", projectId: "proj_a" }) ?? "").toBe("");
  });

  it("тред с flow по-прежнему получает правило и этапы", async () => {
    const { harness } = await withQuick();
    await harness.callRpc("setFlowChoice", { projectId: "proj_a", flowId: "quick" });
    await harness.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "thr_flow", projectId: "proj_a", parentThreadId: null }) });
    expect(harness.registrations.instructionProvider?.({ threadId: "thr_flow", projectId: "proj_a" }) ?? "").toMatch(/only through its stages/);
  });
});

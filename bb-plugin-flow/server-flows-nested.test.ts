// @vitest-environment node
// Этап «Flow» через плагин целиком: тред на flow со строкой получает этапы вложенного flow в инструкциях, в проверке брифа
// и в прогоне; сохранение цикла отклоняется; порядок шагов проверяется по развёрнутым этапам.
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { addFlow } from "./core/flows";
import { stage } from "./core/stages-fixtures";
import { SAVE_FLOW_TOOL_NAME } from "./server/flow-tools";
import { priced } from "./server/priced-fixture";
import type { Flow, FlowSettings, WorkStage } from "./shared/contract";
import plugin from "./server";

const text = (result: unknown) => (typeof result === "string" ? result : JSON.stringify(result));
const todo = (ids: readonly string[]) => ids.map((id) => ({ id, state: "todo" }));
const ref = (id: string, flowId: string): WorkStage => ({ id, kind: "skill", skill: "", name: id, executors: [], flowId });
const flow = (id: string, stages: WorkStage[]): Flow => ({ id, name: id.toUpperCase(), stages });
const automation = (id: string, steps: readonly string[]): WorkStage => ({ id, kind: "skill", skill: "", name: id, executors: [], automation: { source: "flow", steps: steps as never } });

const ANSWER = flow("answer", [stage("project"), { id: "demo", kind: "demo", skill: "", name: "Demonstration", executors: [] }]);
const PLUGIN = flow("plugin", [stage("task"), ref("nested", "answer"), stage("ship")]);

const setup = async (...flows: Flow[]) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  await plugin(bb);
  const current = await harness.callRpc<FlowSettings>("getFlowSettings", {});
  const saved = flows.reduce<FlowSettings>(addFlow, current);
  await harness.callRpc("saveFlowSettings", saved);
  return { harness, saved };
};

const openThread = async (harness: Awaited<ReturnType<typeof setup>>["harness"], flowId: string) => {
  await harness.callRpc("setFlowChoice", { projectId: "proj_a", flowId });
  await harness.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "thr_nested", projectId: "proj_a", parentThreadId: null }) });
  return harness.registrations.instructionProvider?.({ threadId: "thr_nested", projectId: "proj_a" }) ?? "";
};

describe("плагин Flow: этап «Flow»", () => {
  it("тред на flow со строкой получает в инструкциях этапы вложенного flow на месте строки", async () => {
    const { harness } = await setup(ANSWER, PLUGIN);
    const instructions = await openThread(harness, "plugin");
    expect(instructions).toMatch(/1\. task/);
    expect(instructions).toMatch(/nested\.project/);
    expect(instructions).toMatch(/nested\.demo/);
    expect(instructions).toMatch(/ship/);
    expect(instructions.indexOf("nested.project")).toBeLessThan(instructions.indexOf("ship"));
  });

  it("бриф проверяется по развёрнутым этапам: id вложенных принимаются, строка «Flow» как этап — нет", async () => {
    const { harness } = await setup(ANSWER, PLUGIN);
    await openThread(harness, "plugin");
    const flat = ["task", "nested.project", "nested.demo", "ship"];
    expect(text(await harness.callAgentTool("ask_decision", priced({ title: "Бриф", setup: { stages: todo(flat) } }), { threadId: "thr_nested" }))).toMatch(/::decision\{id="dec_/);
    expect(text(await harness.callAgentTool("ask_decision", priced({ title: "Бриф", setup: { stages: todo(["task", "nested", "ship"]) } }), { threadId: "thr_nested" }))).toMatch(/every settings stage once/);
  });

  it("сохранение flow, включившего сам себя, отклоняется с цепочкой, коллекция не меняется", async () => {
    const { harness, saved } = await setup(ANSWER, PLUGIN);
    const looped = { ...saved, flows: saved.flows.map((f) => (f.id === "answer" ? flow("answer", [...ANSWER.stages, ref("back", "plugin")]) : f)) };
    await expect(harness.callRpc("saveFlowSettings", looped)).rejects.toThrow(/ANSWER → PLUGIN → ANSWER|PLUGIN → ANSWER → PLUGIN/);
    expect(await harness.callRpc("getFlowSettings", {})).toEqual(saved);
  });

  it("save_flow тоже отклоняет цикл и ничего не пишет", async () => {
    const { harness, saved } = await setup(ANSWER, PLUGIN);
    const result = await harness.callAgentTool(SAVE_FLOW_TOOL_NAME, { id: "answer", name: "ANSWER", stages: [{ kind: "skill", flowId: "plugin" }] }, { threadId: "thr_x" });
    expect(result).toMatchObject({ isError: true });
    expect(text(result)).toMatch(/includes itself/);
    expect(await harness.callRpc("getFlowSettings", {})).toEqual(saved);
  });

  it("save_flow принимает строку «Flow» по id, а read_flows её возвращает", async () => {
    const { harness } = await setup(ANSWER);
    const result = await harness.callAgentTool(SAVE_FLOW_TOOL_NAME, { id: "outer", name: "Outer", stages: [{ kind: "skill", flowId: "answer", name: "Answer" }] }, { threadId: "thr_x" });
    expect(result).not.toMatchObject({ isError: true });
    const read = (await harness.callAgentTool("read_flows", {}, { threadId: "thr_x" })) as { content: Array<{ text: string }> };
    const outer = (JSON.parse(read.content[0]!.text) as { flows: Flow[] }).flows.find((f) => f.id === "outer");
    expect(outer?.stages).toEqual([expect.objectContaining({ kind: "skill", skill: "", name: "Answer", flowId: "answer" })]);
  });

  it("flow, где бамп стоит после вложенного flow, открывающего PR, сохраняется", async () => {
    const opener = flow("opener", [automation("pr", ["git.create-pr"])]);
    const outer = flow("outer", [ref("nested", "opener"), automation("bump", ["files.bump-patch"])]);
    await expect(setup(opener, outer)).resolves.toBeDefined();
  });

  it("бамп без открытия PR, в том числе во вложенном flow, по-прежнему отклоняется", async () => {
    const outer = flow("outer", [ref("nested", "inner"), automation("bump", ["files.bump-patch"])]);
    await expect(setup(flow("inner", [stage("task")]), outer)).rejects.toThrow();
  });

  it("flow с удалённым вложенным flow открывается: строка этапов не даёт", async () => {
    const { harness } = await setup(PLUGIN);
    const instructions = await openThread(harness, "plugin");
    expect(instructions).toMatch(/1\. task/);
    expect(instructions).toMatch(/2\. ship/);
    expect(instructions).not.toMatch(/nested/);
  });
});

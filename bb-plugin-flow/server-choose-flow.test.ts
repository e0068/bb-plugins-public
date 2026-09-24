// @vitest-environment node
// Тред без flow при включённом выборе агентом: агент читает корневой навык, выбирает flow
// инструментом и сразу получает его этапы. Корневой навык Flow пишет сам из названий и описаний flow.
import { mkdtemp, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { addFlow, newFlow, NO_FLOW, setFlowStages } from "./core/flows";
import { CHOOSE_FLOW_TOOL } from "./lib/stage-constants";
import type { FlowSettings } from "./shared/contract";
import plugin from "./server";

const text = (result: unknown) => (typeof result === "string" ? result : JSON.stringify(result));
const skillPath = () => join(homedir(), ".claude", "skills", "flow", "SKILL.md");

/** Плагин с Default и Quick; тред thr_none создан в проекте, где выбрано «без flow». */
const setup = async (agentChoosesFlow: boolean) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  await plugin(bb);
  const current = await harness.callRpc<FlowSettings>("getFlowSettings", {});
  const quick = setFlowStages(addFlow(current, { ...newFlow("quick", "Quick"), description: "Мелкие правки" }), "quick", (stages) => stages.filter((s) => s.id === "criteria" || s.id === "implement"));
  await harness.callRpc("saveFlowSettings", { ...quick, agentChoosesFlow });
  await harness.callRpc("setFlowChoice", { projectId: "proj_a", flowId: NO_FLOW });
  await harness.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "thr_none", projectId: "proj_a", parentThreadId: null }) });
  const instructions = (threadId: string) => harness.registrations.instructionProvider?.({ threadId, projectId: "proj_a" }) ?? "";
  return { harness, instructions };
};

describe("выбор flow агентом", () => {
  it("выключен — тред без flow инструкций не получает, как раньше", async () => {
    const { instructions } = await setup(false);
    expect(instructions("thr_none")).toBe("");
  });

  it("включён — тред без flow получает указание загрузить корневой навык и выбрать flow инструментом", async () => {
    const { instructions } = await setup(true);
    expect(instructions("thr_none")).toContain("`flow`");
    expect(instructions("thr_none")).toContain(CHOOSE_FLOW_TOOL);
  });

  it("выбранный инструментом flow назначается треду, и его этапы приходят сразу в ответе и дальше в инструкциях", async () => {
    const { harness, instructions } = await setup(true);
    const answer = text(await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: "quick" }, { threadId: "thr_none" }));
    expect(answer).toMatch(/1\. criteria/);
    expect(answer).toMatch(/2\. implement/);
    expect(instructions("thr_none")).toMatch(/2\. implement/);
    expect(instructions("thr_none")).not.toContain(CHOOSE_FLOW_TOOL);
  });

  it("выключен — инструмент flow не назначает", async () => {
    const { harness, instructions } = await setup(false);
    expect(text(await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: "quick" }, { threadId: "thr_none" }))).toMatch(/not let/);
    expect(instructions("thr_none")).toBe("");
  });

  it("ни один flow не подходит — агент оставляет тред без flow, и указание выбрать больше не приходит", async () => {
    const { harness, instructions } = await setup(true);
    expect(await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: NO_FLOW }, { threadId: "thr_none" })).not.toMatchObject({ isError: true });
    expect(instructions("thr_none")).toBe("");
    expect(text(await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: "quick" }, { threadId: "thr_none" }))).toMatch(/already/);
  });

  it("неизвестный flow не назначается", async () => {
    const { harness, instructions } = await setup(true);
    expect(text(await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: "gone" }, { threadId: "thr_none" }))).toMatch(/gone/);
    expect(instructions("thr_none")).toContain(CHOOSE_FLOW_TOOL);
  });

  it("треду, у которого flow уже есть, инструмент flow не меняет", async () => {
    const { harness, instructions } = await setup(true);
    await harness.callRpc("setFlowChoice", { projectId: "proj_b", flowId: "default" });
    await harness.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: "thr_default", projectId: "proj_b", parentThreadId: null }) });
    const before = instructions("thr_default");
    expect(text(await harness.callAgentTool(CHOOSE_FLOW_TOOL, { flowId: "quick" }, { threadId: "thr_default" }))).toMatch(/already/);
    expect(instructions("thr_default")).toBe(before);
  });
});

describe("корневой навык пишет Flow", () => {
  it("сохранение flow переписывает корневой навык названиями и описаниями", async () => {
    await setup(false);
    const skill = await readFile(skillPath(), "utf8");
    expect(skill).toContain("`quick`");
    expect(skill).toContain("Мелкие правки");
  });

  it("навык пишется при запуске, до первого сохранения", async () => {
    // Свой дом: навык, записанный сохранением в прошлых тестах файла, здесь не засчитывается.
    process.env.HOME = await mkdtemp(join(homedir(), "start-"));
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    await plugin(bb);
    expect(await readFile(skillPath(), "utf8")).toContain("`default`");
  });

  it("read_flows отдаёт описание, save_flow его принимает", async () => {
    const { harness } = await setup(false);
    expect(text(await harness.callAgentTool("read_flows", {}, { threadId: "thr_none" }))).toContain("Мелкие правки");
    await harness.callAgentTool("save_flow", { id: "quick", name: "Quick", description: "Опечатки", stages: [{ kind: "criteria" }] }, { threadId: "thr_none" });
    const saved = await harness.callRpc<FlowSettings>("getFlowSettings", {});
    expect(saved.flows.find((f) => f.id === "quick")?.description).toBe("Опечатки");
  });
});

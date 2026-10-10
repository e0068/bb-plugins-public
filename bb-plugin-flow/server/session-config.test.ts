// @vitest-environment node
// Перед стартом сессии bb спрашивает плагин, какие его инструменты и навыки дать агенту: Flow отдаёт все свои —
// выбор нужен ему только как точка перед стартом, где кладётся файл ограничения навыков (./skill-scope.ts).
import { readdirSync } from "node:fs";
import { createFakePluginHost, makePluginAgentConfigurationContext } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { FLOW_SKILLS, registerSessionConfig } from "./session-config";

const shipped = readdirSync(new URL("../skills/", import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const setup = (prestart: (threadId: string, root: string | null) => void) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", agentSkillIds: shipped });
  for (const name of ["ask_decision", "flow_stage"])
    bb.agents.registerTool({ name, description: name, parameters: { type: "object", properties: {} }, execute: async () => "" });
  registerSessionConfig(bb, { tools: ["ask_decision", "flow_stage"], prestart, warn: () => undefined });
  return harness;
};

const worktree = { path: "/tree", workspaceProvisionType: "managed-worktree" as const };

describe("настройка сессии агента", () => {
  it("навыки Flow в выборе — ровно те, что плагин везёт в skills/", () => {
    expect([...FLOW_SKILLS].sort()).toEqual([...shipped].sort());
  });

  it("сессия получает все инструменты и навыки Flow", async () => {
    const harness = setup(() => undefined);
    const resolved = await harness.resolveAgentConfiguration(makePluginAgentConfigurationContext({ environment: worktree }));
    expect(resolved.tools.map((tool) => tool.name).sort()).toEqual(["ask_decision", "flow_stage"]);
    expect([...resolved.skills].sort()).toEqual([...shipped].sort());
  });

  it("сессия Side chat не получает ни инструментов, ни навыков Flow и не трогает навыки общего дерева", async () => {
    const calls: string[] = [];
    const harness = setup((threadId) => void calls.push(threadId));
    const resolved = await harness.resolveAgentConfiguration(makePluginAgentConfigurationContext({ environment: worktree, origin: { kind: "fork", pluginId: "side-chat" } }));
    expect([resolved.tools, resolved.skills, calls]).toEqual([[], [], []]);
  });

  it("форк другого плагина получает инструменты Flow как обычно", async () => {
    const harness = setup(() => undefined);
    const resolved = await harness.resolveAgentConfiguration(makePluginAgentConfigurationContext({ environment: worktree, origin: { kind: "fork", pluginId: "other" } }));
    expect(resolved.tools.map((tool) => tool.name).sort()).toEqual(["ask_decision", "flow_stage"]);
  });

  it("перед стартом сессии в worktree файл ограничения ложится в дерево треда", async () => {
    const calls: Array<[string, string | null]> = [];
    const harness = setup((threadId, root) => void calls.push([threadId, root]));
    await harness.resolveAgentConfiguration(makePluginAgentConfigurationContext({ thread: { id: "thr" }, environment: worktree }));
    expect(calls).toEqual([["thr", "/tree"]]);
  });

  it("личная копия и окружение без пути файла не получают: отложенное решение забывается", async () => {
    const calls: Array<[string, string | null]> = [];
    const harness = setup((threadId, root) => void calls.push([threadId, root]));
    await harness.resolveAgentConfiguration(makePluginAgentConfigurationContext({ thread: { id: "a" }, environment: { path: "/home", workspaceProvisionType: "personal" } }));
    await harness.resolveAgentConfiguration(makePluginAgentConfigurationContext({ thread: { id: "b" }, environment: { path: null, workspaceProvisionType: "managed-worktree" } }));
    expect(calls).toEqual([["a", null], ["b", null]]);
  });

  it("сбой записи не отнимает у сессии инструменты Flow", async () => {
    const harness = setup(() => {
      throw new Error("disk full");
    });
    const resolved = await harness.resolveAgentConfiguration(makePluginAgentConfigurationContext({ environment: worktree }));
    expect(resolved.tools).toHaveLength(2);
  });
});

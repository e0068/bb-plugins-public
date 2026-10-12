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

const setup = (prestart: (threadId: string, root: string | null) => void, startMessage?: (threadId: string) => string | null) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", agentSkillIds: shipped });
  for (const name of ["ask_decision", "flow_stage"])
    bb.agents.registerTool({ name, description: name, parameters: { type: "object", properties: {} }, execute: async () => "" });
  registerSessionConfig(bb, { tools: ["ask_decision", "flow_stage"], prestart, ...(startMessage === undefined ? {} : { startMessage }), warn: () => undefined });
  return harness;
};

const worktree = { path: "/tree", workspaceProvisionType: "managed-worktree" as const };

describe("настройка сессии агента", () => {
  it("стартовое сообщение flow треда — инструкция сессии; без сообщения инструкции нет", async () => {
    const withStart = setup(() => undefined, (threadId) => (threadId === "thr_flow" ? "Сначала воспроизведи баг" : null));
    const flow = await withStart.resolveAgentConfiguration(makePluginAgentConfigurationContext({ environment: worktree, thread: { id: "thr_flow" } }));
    expect(flow.instructions).toBe("Сначала воспроизведи баг");
    const plain = await withStart.resolveAgentConfiguration(makePluginAgentConfigurationContext({ environment: worktree, thread: { id: "thr_plain" } }));
    expect(plain.instructions).toBeNull();
  });

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

it.each(["codex", "kimi", "acp-kimi"])("%s receives the delivered Flow skill paths", async (providerId) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", agentSkillIds: shipped });
  const calls: Array<[string, string | null]> = [];
  registerSessionConfig(bb, { tools: [], prestart: () => undefined, warn: () => undefined, deliver: (id, root) => { calls.push([id, root]); return "spec: /tree/.agents/skills/spec/SKILL.md"; } });
  const config = await harness.resolveAgentConfiguration(makePluginAgentConfigurationContext({ thread: { id: "t" }, environment: worktree, provider: { id: providerId } }));
  expect(config.instructions).toContain("spec: /tree/.agents/skills/spec/SKILL.md");
  expect(calls).toEqual([["t", "/tree"]]);
});

it("доставка навыков и стартовое сообщение flow — одной инструкцией, доставка первой; Claude Code получает только сообщение", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", agentSkillIds: shipped });
  registerSessionConfig(bb, { tools: [], prestart: () => undefined, warn: () => undefined, deliver: () => "spec: /tree/spec/SKILL.md", startMessage: () => "Пиши коротко" });
  const codex = await harness.resolveAgentConfiguration(makePluginAgentConfigurationContext({ thread: { id: "t" }, environment: worktree, provider: { id: "codex" } }));
  expect(codex.instructions).toBe("spec: /tree/spec/SKILL.md\n\nПиши коротко");
  const claude = await harness.resolveAgentConfiguration(makePluginAgentConfigurationContext({ thread: { id: "t" }, environment: worktree, provider: { id: "claude-code" } }));
  expect(claude.instructions).toBe("Пиши коротко");
});

// @vitest-environment node
// Настройки Claude Code в дереве треда: Flow пишет .claude/settings.local.json по открытым этапам flow,
// не трогает ключи владельца и ничего не прячет, что уже открыл.
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import type { Flow, FlowProgress, StageCatalog, WorkStage } from "../shared/contract";
import { createSkillScope } from "./skill-scope";

const at = "2026-10-07T10:00:00.000Z";
const stage = (id: string, skill: string, executors: WorkStage["executors"] = []): WorkStage => ({ id, name: id, skill, executors });
const STAGES = [stage("brief", "flow-questions"), stage("spec", "spec"), stage("review", "code-review", [{ id: "agent:code-reviewer", kind: "agent", name: "code-reviewer" }])];
const FLOW: Flow = { id: "f", name: "F", stages: STAGES, limitSkills: true, limitAgents: true };
const CATALOG: StageCatalog = {
  skills: ["flow-questions", "spec", "code-review", "plan"].map((name) => ({ name, origin: { kind: "own" as const } })),
  executors: [
    { id: "agent:code-reviewer", kind: "agent", name: "code-reviewer", origin: { kind: "own" } },
    { id: "agent:scout", kind: "agent", name: "scout", origin: { kind: "own" } },
  ],
};

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

const setup = async (options: { flow?: Flow | null; worktree?: boolean } = {}) => {
  const root = await mkdtemp(join(tmpdir(), "skill-scope-"));
  dirs.push(root);
  const { bb } = createFakePluginHost({ pluginId: "flow" });
  let progress: FlowProgress | null = null;
  let flow = options.flow === undefined ? FLOW : options.flow;
  const scope = createSkillScope({
    kv: bb.storage.kv,
    worktree: async () => (options.worktree === false ? null : root),
    flow: () => flow,
    stages: () => flow?.stages ?? [],
    progress: async () => progress,
    catalog: async () => CATALOG,
    plugins: async () => [],
    workflowScripts: async () => [],
    warn: () => undefined,
  });
  const file = join(root, ".claude", "settings.local.json");
  const read = async () => JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  return {
    scope,
    file,
    read,
    mark: (tracks: FlowProgress["stages"]) => void (progress = { stages: tracks, waiting: [] }),
    setFlow: (next: Flow | null) => void (flow = next),
  };
};

describe("настройки Claude Code в дереве треда", () => {
  it("на первом этапе открыт его навык и навык следующего, остальное спрятано, агенты вне исполнителей тоже", async () => {
    const { scope, read } = await setup();
    await scope.sync("thr");
    const json = await read();
    expect(json.skillOverrides).toEqual({ "code-review": "off", plan: "off" });
    expect(json.permissions).toEqual({ deny: expect.arrayContaining(["Agent(scout)", "Agent(code-reviewer)", "Agent(Explore)"]) });
  });

  it("отмеченный этап открывает свой навык и агентов в том же файле", async () => {
    const { scope, read, mark } = await setup();
    await scope.sync("thr");
    mark({ brief: { startedAt: at, finishedAt: at }, spec: { startedAt: at, finishedAt: at } });
    await scope.sync("thr");
    const json = await read();
    expect(json.skillOverrides).toEqual({ plan: "off" });
    expect((json.permissions as { deny: string[] }).deny).not.toContain("Agent(code-reviewer)");
  });

  it("однажды открытое не прячется, даже если этап вернули на доработку", async () => {
    const { scope, read, mark } = await setup();
    mark({ brief: { startedAt: at, finishedAt: at }, spec: { startedAt: at } });
    await scope.sync("thr");
    mark({ brief: { startedAt: at } });
    await scope.sync("thr");
    expect((await read()).skillOverrides).toEqual({ plan: "off" });
  });

  it("ключи владельца остаются, а выключенные переключатели возвращают файл как был", async () => {
    const { scope, read, file, setFlow } = await setup();
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, JSON.stringify({ model: "opus", permissions: { allow: ["Bash(ls)"] } }));
    await scope.sync("thr");
    expect(await read()).toMatchObject({ model: "opus", permissions: { allow: ["Bash(ls)"] } });
    setFlow({ ...FLOW, limitSkills: undefined, limitAgents: undefined });
    await scope.sync("thr");
    expect(await read()).toEqual({ model: "opus", permissions: { allow: ["Bash(ls)"] } });
  });

  it("тред без flow, flow без переключателей и тред вне worktree файла не получают", async () => {
    for (const options of [{ flow: null }, { flow: { ...FLOW, limitSkills: undefined, limitAgents: undefined } }, { worktree: false }]) {
      const { scope, read } = await setup(options);
      await scope.sync("thr");
      await expect(read()).rejects.toThrow();
    }
  });

  it("битый файл владельца не перезаписывается", async () => {
    const { scope, file } = await setup();
    await mkdir(join(file, ".."), { recursive: true });
    await writeFile(file, "{ битый");
    await scope.sync("thr");
    expect(await readFile(file, "utf8")).toBe("{ битый");
  });
});

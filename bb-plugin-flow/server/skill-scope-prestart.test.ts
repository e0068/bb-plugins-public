// @vitest-environment node
// Первая сессия треда стартует уже с ограничением: сверка в хуке первого сообщения идёт, пока дерева треда ещё нет,
// и откладывает решение, а запись перед стартом сессии кладёт файл синхронно — Claude Code читает его на старте.
// Тред с «Автоматически» до выбора flow видит только то, что Flow не прячет.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
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

const setup = async (options: { flow?: Flow | null; personal?: boolean } = {}) => {
  const root = await mkdtemp(join(tmpdir(), "skill-prestart-"));
  dirs.push(root);
  const { bb } = createFakePluginHost({ pluginId: "flow" });
  let progress: FlowProgress | null = null;
  let flow = options.flow === undefined ? FLOW : options.flow;
  // Дерево появляется, когда bb его создаст: до того сверка его не находит.
  let provisioned = false;
  let catalogReads = 0;
  const deps = {
    kv: bb.storage.kv,
    worktree: async () => (provisioned && options.personal !== true ? root : null),
    // Личная копия своего дерева не получит никогда; тред без окружения его ещё ждёт.
    pending: async () => !provisioned && options.personal !== true,
    flow: () => flow,
    stages: () => flow?.stages ?? [],
    progress: async () => progress,
    catalog: async () => {
      catalogReads += 1;
      return CATALOG;
    },
    plugins: async () => [],
    workflowScripts: async () => [],
    warn: () => undefined,
  };
  const scope = createSkillScope(deps);
  const file = join(root, ".claude", "settings.local.json");
  return {
    scope,
    root,
    file,
    readNow: () => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>,
    read: async () => JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>,
    provision: () => void (provisioned = true),
    /** Тот же kv, новый экземпляр — как после перезагрузки плагина. */
    reloaded: () => createSkillScope(deps),
    catalogReads: () => catalogReads,
    mark: (tracks: FlowProgress["stages"]) => void (progress = { stages: tracks, waiting: [] }),
    choose: (next: Flow | null) => void (flow = next),
  };
};

describe("первая сессия треда — с ограничением с самого старта", () => {
  it("сверка до появления дерева файла не пишет, а запись перед стартом сессии кладёт его сразу, без ожидания", async () => {
    const { scope, root, file, readNow } = await setup();
    await scope.sync("thr");
    expect(existsSync(file)).toBe(false);
    expect(scope.prestart("thr", root)).toBe(true);
    expect(readNow().skillOverrides).toEqual({ "code-review": "off", plan: "off" });
    expect(readNow().disableBundledSkills).toBe(true);
  });

  it("без отложенной сверки запись перед стартом ничего не пишет", async () => {
    const { scope, root, file } = await setup();
    expect(scope.prestart("thr", root)).toBe(false);
    expect(existsSync(file)).toBe(false);
  });

  it("отложенное решение пишется один раз: следующая сессия файл перед стартом не трогает", async () => {
    const { scope, root } = await setup();
    await scope.sync("thr");
    expect(scope.prestart("thr", root)).toBe(true);
    expect(scope.prestart("thr", root)).toBe(false);
  });

  it("после записи перед стартом сверка знает, что записал Flow, и открывает следующий этап без остатков", async () => {
    const { scope, root, read, provision, mark } = await setup();
    await scope.sync("thr");
    scope.prestart("thr", root);
    provision();
    mark({ brief: { startedAt: at, finishedAt: at }, spec: { startedAt: at } });
    await scope.sync("thr");
    const json = await read();
    expect(json.skillOverrides).toEqual({ plan: "off" });
    expect((json.permissions as { deny: string[] }).deny).not.toContain("Agent(code-reviewer)");
  });

  it("тред с «Автоматически» до выбора ничего не прячет: файл не пишется — новой сессии после выбора нет, урезать первую незачем", async () => {
    const { scope, root, file } = await setup({ flow: null });
    await scope.sync("thr");
    expect(scope.prestart("thr", root)).toBe(false);
    expect(existsSync(file)).toBe(false);
  });

  it("тред в личной копии решения не считает и не откладывает", async () => {
    const { scope, root, catalogReads } = await setup({ personal: true });
    await scope.sync("thr");
    expect(catalogReads()).toBe(0);
    expect(scope.prestart("thr", root)).toBe(false);
  });

  it("ожидание сверок треда кончается, когда кончилась последняя поставленная", async () => {
    const { scope, provision, read } = await setup();
    provision();
    void scope.sync("thr");
    await scope.settled("thr");
    expect((await read()).skillOverrides).toEqual({ "code-review": "off", plan: "off" });
  });

  it("агент выбрал flow — сверка кладёт ограничения его этапов в готовое дерево", async () => {
    const { scope, provision, choose, read } = await setup({ flow: null });
    await scope.sync("thr");
    provision();
    choose(FLOW);
    await scope.sync("thr");
    expect((await read()).skillOverrides).toEqual({ "code-review": "off", plan: "off" });
  });
});

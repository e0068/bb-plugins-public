// @vitest-environment node
// Тред другого провайдера исполнителем этапа на фейковом bb: лимиты во вкладе хода и дочерний тред по отметке (BBPL-965).
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { WorkStage } from "../shared/contract";
import { createProviderThreads, paceLeadSetting } from "./provider-threads";

const codexExecutor = { id: "thread:codex", kind: "thread" as const, name: "Тред Codex", provider: "codex" };
const practice: WorkStage = { id: "practice", name: "Execution", kind: "skill", skill: "code-standards-fp", executors: [codexExecutor] };
const START = Date.parse("2026-10-26T12:00:00.000Z");
// Из пятичасового окна прошла половина: сброс через два с половиной часа.
const window = (usedPercent: number) => ({ status: "ok", accountEmail: null, planLabel: null, windows: [{ label: "Current session", usedPercent, resetsAt: new Date(START + 2.5 * 3_600_000).toISOString() }] });

const setup = (options: { usage?: () => Promise<unknown>; spawn?: (args: unknown) => Promise<unknown>; stages?: readonly WorkStage[]; lead?: () => number } = {}) => {
  const spawned: unknown[] = [];
  const expected: string[] = [];
  let now = START;
  const { bb } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      system: { usageLimits: options.usage ?? (async () => ({ "claude-code": window(92), codex: window(10) })) },
      threads: {
        get: async ({ threadId }: { threadId: string }) => makeThreadResponse({ id: threadId, projectId: "proj_a", environmentId: "env_1", title: "BBPL-965 Flow" }),
        spawn: async (args: unknown) => {
          spawned.push(args);
          return options.spawn === undefined ? makeThreadResponse({ id: "thr_codex", projectId: "proj_a" }) : options.spawn(args);
        },
      },
    } as never,
  });
  const threads = createProviderThreads(bb, {
    stages: () => options.stages ?? [practice],
    expectDelegate: (parentId) => expected.push(parentId),
    criteria: async () => ["Тред Codex выбирается исполнителем"],
    skillPath: async () => "/home/owner/.claude/skills/code-standards-fp/SKILL.md",
    now: () => now,
    lead: options.lead ?? (() => 20),
  });
  return { threads, spawned, expected, tick: (ms: number) => (now += ms) };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("лимиты во вкладе хода", () => {
  it("первый ход читает лимиты в фоне, следующий уже несёт совет отдать этап Codex", async () => {
    const { threads } = setup();
    expect(threads.line("thr_parent")).toBeNull();
    await settle();
    expect(threads.line("thr_parent")).toContain("recommend executor thread:codex");
  });

  it("порог обгона читается на каждом ходу: настройку поменяли — совет следует за ней", async () => {
    let lead = 20;
    const { threads } = setup({ lead: () => lead });
    threads.line("thr_parent");
    await settle();
    expect(threads.line("thr_parent")).toContain("recommend executor thread:codex");
    lead = 100;
    expect(threads.line("thr_parent")).not.toContain("recommend executor thread:codex");
  });

  it("bb не ответил о лимитах — строки нет, ход не падает", async () => {
    const { threads } = setup({ usage: async () => Promise.reject(new Error("offline")) });
    threads.line("thr_parent");
    await settle();
    expect(threads.line("thr_parent")).toBeNull();
  });
});

describe("лимиты без тредов провайдеров и при сбое SDK", () => {
  it("flow без тредов провайдеров лимиты не читает", async () => {
    let reads = 0;
    const { threads } = setup({ usage: async () => (reads += 1, {}), stages: [{ ...practice, executors: [] }] });
    expect(threads.line("thr_parent")).toBeNull();
    await settle();
    expect(reads).toBe(0);
  });

  it("SDK бросил синхронно — ход получает «нет строки», а не исключение", async () => {
    const { threads } = setup({
      usage: (() => {
        throw new Error("not stubbed");
      }) as never,
    });
    expect(() => threads.line("thr_parent")).not.toThrow();
    await settle();
    expect(threads.line("thr_parent")).toBeNull();
  });
});

describe("дочерний тред этапа", () => {
  it("заводится на Codex в окружении родителя, его ребёнком, с этапом, навыком, Definition of Done и результатами", async () => {
    const { threads, spawned, expected } = setup();
    const result = await threads.delegate({ threadId: "thr_parent", stage: practice, providerId: "codex", results: [{ label: "spec.md", target: "docs/specs/spec.md" }] });
    expect(result).toEqual({ kind: "created", threadId: "thr_codex" });
    expect(expected).toEqual(["thr_parent"]);
    const args = spawned[0] as { projectId: string; parentThreadId: string; providerId: string; environment: unknown; prompt: string; title: string };
    expect(args).toMatchObject({ projectId: "proj_a", parentThreadId: "thr_parent", providerId: "codex", environment: { type: "reuse", environmentId: "env_1" } });
    expect(args.title).toContain("Execution");
    expect(args.prompt).toContain("/home/owner/.claude/skills/code-standards-fp/SKILL.md");
    expect(args.prompt).toContain("- Тред Codex выбирается исполнителем");
    expect(args.prompt).toContain("- spec.md — docs/specs/spec.md");
  });

  it("bb не завёл тред — исход со строкой ошибки, без исключения", async () => {
    const { threads } = setup({ spawn: async () => Promise.reject(new Error("provider codex is not installed")) });
    expect(await threads.delegate({ threadId: "thr_parent", stage: practice, providerId: "codex", results: [] })).toEqual({ kind: "failed", error: "provider codex is not installed" });
  });
});

describe("настройка порога обгона", () => {
  it("по умолчанию 20%, принимает целое от 1 до 500 и отклоняет ноль, 501 и дробь", () => {
    const { default: initial, experimental_schema: schema } = paceLeadSetting.providerPaceLead;
    expect(initial).toBe(20);
    for (const good of [1, 500]) expect(schema.safeParse(good).success).toBe(true);
    for (const bad of [0, 501, 12.5]) expect(schema.safeParse(bad).success).toBe(false);
  });
});

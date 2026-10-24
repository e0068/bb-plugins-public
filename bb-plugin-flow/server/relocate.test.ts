import { describe, expect, it } from "vitest";

import { TREE_STEP } from "../core/relocation";
import type { WorkStage } from "../shared/contract";
import { createRelocation, RELOCATING_REASON, type FirstDispatch } from "./relocate";

const tree = { id: "tree", kind: "skill", skill: "", name: "Дерево", executors: [], automation: { source: "flow", steps: [TREE_STEP] } } as unknown as WorkStage;
const work = { id: "work", kind: "skill", skill: "x", name: "Работа", executors: [] } as unknown as WorkStage;

const dispatch = (environmentIntent: unknown): FirstDispatch => ({
  thread: { id: "thr_s", projectId: "p", title: "Кнопка" },
  hostId: "host_1",
  environmentIntent,
  blocks: [{ type: "text", text: "Сделай кнопку", mentions: [] }],
  execution: { providerId: "claude-code", model: "opus", reasoningLevel: "high", serviceTier: "fast" },
});

const checkout = { kind: "provider", environmentProviderId: "project-checkout" };

const world = (over: { stages?: readonly WorkStage[]; spawn?: () => Promise<{ id: string }>; env?: object } = {}) => {
  const log: string[] = [];
  const spawned: unknown[] = [];
  const started: string[] = [];
  let rechecks = 0;
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const relocation = createRelocation({
    sdk: {
      threads: {
        spawn: async (args: unknown) => {
          spawned.push(args);
          return over.spawn === undefined ? { id: "thr_new" } : over.spawn();
        },
        open: async ({ threadId }: { threadId: string }) => void log.push(`open:${threadId}`),
        archive: async ({ threadId }: { threadId: string }) => void log.push(`archive:${threadId}`),
      },
      environments: { get: async () => over.env },
    } as never,
    stagesOf: () => over.stages ?? [tree, work],
    recheck: async () => void (rechecks += 1),
    started: async (threadId) => void started.push(threadId),
    warn: (message) => void log.push(`warn:${message}`),
  });
  return { relocation, log, spawned, started, flush, rechecks: () => rechecks };
};

describe("перенос треда из чекаута", () => {
  it("чекаут и шаг дерева первым этапом: сообщение ждёт, новый тред в worktree от origin/main с тем же сообщением, моделью, скоростью и названием, у него прогон, исходный в архиве", async () => {
    const { relocation, log, spawned, started, flush, rechecks } = world();
    expect(await relocation.hold(dispatch(checkout))).toEqual({ action: "wait", reason: RELOCATING_REASON });
    await flush();
    expect(spawned).toEqual([
      {
        projectId: "p",
        title: "Кнопка",
        environment: { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: "origin/main" } } },
        providerId: "claude-code",
        model: "opus",
        reasoningLevel: "high",
        serviceTier: "fast",
        input: [expect.objectContaining({ type: "text", text: expect.stringContaining("@thread:thr_s") }), { type: "text", text: "Сделай кнопку", mentions: [] }],
      },
    ]);
    expect(started).toEqual(["thr_new"]);
    expect(log).toEqual(["open:thr_new", "archive:thr_s"]);
    expect(relocation.isRelocated("thr_new")).toBe(true);
    expect(rechecks()).toBe(1);
  });

  it("после переноса сообщение исходного треда снимается отказом со ссылкой на новый — в архиве оно не висит упавшим", async () => {
    const { relocation, flush } = world();
    await relocation.hold(dispatch(checkout));
    await flush();
    expect(await relocation.hold(dispatch(checkout))).toEqual({ action: "reject", message: "Тред перенесён в @thread:thr_new" });
  });

  it("готовое окружение-чекаут: база — origin/<ветка по умолчанию окружения>", async () => {
    const { relocation, spawned, flush } = world({ env: { hostId: "host_2", isGitRepo: true, isWorktree: false, managed: false, defaultBranch: "master" } });
    expect(await relocation.hold(dispatch({ kind: "environment", environmentId: "env_1" }))).toEqual({ action: "wait", reason: RELOCATING_REASON });
    await flush();
    expect(spawned).toEqual([expect.objectContaining({ environment: { type: "host", hostId: "host_2", workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: "origin/master" } } } })]);
  });

  it("готовое окружение — worktree: тред остаётся, нового нет", async () => {
    const { relocation, spawned } = world({ env: { hostId: "h", isGitRepo: true, isWorktree: true, managed: true, defaultBranch: "main" } });
    expect(await relocation.hold(dispatch({ kind: "environment", environmentId: "env_1" }))).toBeNull();
    expect(spawned).toEqual([]);
  });

  it("новый worktree или шаг дерева не первым этапом — тред остаётся", async () => {
    expect(await world().relocation.hold(dispatch({ kind: "provider", environmentProviderId: "git-worktree" }))).toBeNull();
    const late = world({ stages: [work, tree] });
    expect(await late.relocation.hold(dispatch(checkout))).toBeNull();
    expect(late.spawned).toEqual([]);
  });

  it("тред не завёлся — сообщение отпускается в чекаут: хук спрашивается заново и больше не держит", async () => {
    const { relocation, log, flush, rechecks } = world({ spawn: async () => Promise.reject(new Error("no host")) });
    expect(await relocation.hold(dispatch(checkout))).toEqual({ action: "wait", reason: RELOCATING_REASON });
    await flush();
    expect(rechecks()).toBe(1);
    expect(log).toEqual(["warn:relocation: the thread stays in the project checkout (no host)"]);
    expect(await relocation.hold(dispatch(checkout))).toBeNull();
  });
});

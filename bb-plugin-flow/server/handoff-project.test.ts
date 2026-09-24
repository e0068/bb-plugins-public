// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionBrief, DispatchPlace, DispatchRoute } from "../shared/contract";
import { handoff } from "./handoff";

const brief: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_src",
  title: "Flow — отправка в другой проект",
  createdAt: "2026-09-18T10:00:00.000Z",
  kind: "brief",
  questions: [],
};

const spawned = async (route: DispatchRoute, place: Exclude<DispatchPlace, "here"> = "thread") => {
  const calls: Array<Record<string, unknown>> = [];
  const sdk = {
    threads: {
      get: async () => ({ id: "thr_src", projectId: "proj_1", environmentId: "env_1", title: "Исходный тред" }),
      spawn: async (args: Record<string, unknown>) => {
        calls.push(args);
        return { id: "thr_new" };
      },
    },
    environments: { get: async () => ({ hostId: "host_1", branchName: "bb/thr_src", path: "/w/thr_src" }) },
  };
  const result = await handoff({ sdk } as never, { brief, place, route, text: "Ответ владельца" });
  return { call: calls[0]!, result };
};

describe("передача работы в другой проект", () => {
  it("тред заводится в выбранном проекте, а не в проекте исходного треда", async () => {
    const { call, result } = await spawned({ tree: "new", branch: "none", projectId: "proj_2" }, "other");
    expect(call.projectId).toBe("proj_2");
    expect(call.environment).toEqual({ type: "host", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } });
    expect(result).toEqual({ kind: "created", threadId: "thr_new" });
  });

  it("чекаут чужого проекта — его рабочая копия, без смены ветки", async () => {
    const { call } = await spawned({ tree: "local", branch: "none", projectId: "proj_2" }, "other");
    expect(call.environment).toEqual({ type: "host", workspace: { type: "unmanaged", path: null } });
  });

  it("у треда в чужом проекте родителя нет: чужой проект — отдельное место, дочерним он не бывает", async () => {
    const { call } = await spawned({ tree: "new", branch: "none", projectId: "proj_2" }, "other");
    expect(call.parentThreadId).toBeUndefined();
  });

  it("первое сообщение остаётся упоминанием исходного треда", async () => {
    const { call } = await spawned({ tree: "new", branch: "none", projectId: "proj_2" }, "other");
    const input = call.input as Array<{ text: string; mentions: Array<{ resource: { threadId: string; projectId: string } }> }>;
    expect(input[0]?.text).toContain("Ответ владельца");
    expect(input[0]?.mentions[0]?.resource).toMatchObject({ threadId: "thr_src", projectId: "proj_1" });
  });
});

describe("отвод ветки в дереве треда", () => {
  it("отвод идёт тем же деревом с новой веткой", async () => {
    const { call } = await spawned({ tree: "same", branch: "from-current" });
    expect(call.parentThreadId).toBeUndefined();
    expect(call.projectId).toBe("proj_1");
    expect(call.environment).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: { type: "unmanaged", path: "/w/thr_src", branch: { kind: "new", baseBranch: "bb/thr_src" } },
    });
  });

  it("текущая ветка в дереве треда по-прежнему переиспользует окружение", async () => {
    const { call } = await spawned({ tree: "same", branch: "current" });
    expect(call.environment).toEqual({ type: "reuse", environmentId: "env_1" });
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionBrief, DispatchPlace } from "../shared/contract";
import { handoff } from "./handoff";

const brief: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_src",
  title: "Flow — дочерний тред",
  createdAt: "2026-09-17T10:00:00.000Z",
  kind: "brief",
  questions: [],
};

type Mention = { start: number; end: number; resource: { kind: string; threadId: string; label: string } };

const spawned = async (place: Exclude<DispatchPlace, "here">) => {
  const calls: Array<Record<string, unknown>> = [];
  const sdk = {
    threads: {
      get: async () => ({ id: "thr_src", projectId: "proj_1", environmentId: "env_1", title: "Исходный тред" }),
      spawn: async (args: Record<string, unknown>) => {
        calls.push(args);
        return { id: "thr_new" };
      },
    },
    environments: { get: async () => ({ hostId: "host_1", branchName: "bb/thr_src" }) },
  };
  const result = await handoff({ sdk } as never, { brief, place, route: { tree: "new", branch: "from-current" }, text: "Ответ владельца" });
  return { call: calls[0]!, result };
};

describe("передача работы дочернему треду", () => {
  it("дочерний тред создаётся с родителем — исходным тредом", async () => {
    const { call, result } = await spawned("child");
    expect(call.parentThreadId).toBe("thr_src");
    expect(result).toEqual({ kind: "created", threadId: "thr_new" });
  });

  it("новый тред тем же маршрутом остаётся без родителя", async () => {
    const { call } = await spawned("thread");
    expect(call.parentThreadId).toBeUndefined();
  });

  it("дерево и ветка дочернего треда — по выбранному маршруту, как у соседнего", async () => {
    const { call } = await spawned("child");
    expect(call.environment).toEqual({ type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: "bb/thr_src" } } });
  });

  it("первое сообщение дочернего треда упоминает исходный", async () => {
    const { call } = await spawned("child");
    const [input] = call.input as Array<{ type: string; text: string; mentions: Mention[] }>;
    expect(input?.mentions[0]?.resource).toMatchObject({ kind: "thread", threadId: "thr_src" });
  });
});

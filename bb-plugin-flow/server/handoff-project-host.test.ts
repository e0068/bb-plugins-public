// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { handoff } from "./handoff";

const brief: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_src",
  title: "Flow — отправка в другой проект",
  createdAt: "2026-09-29T10:00:00.000Z",
  kind: "brief",
  questions: [],
};

type Source = { hostId: string; isDefault: boolean };

const sentTo = async (sources: readonly Source[], tree: "new" | "local" = "new") => {
  const calls: Array<Record<string, unknown>> = [];
  const sdk = {
    threads: {
      get: async () => ({ id: "thr_src", projectId: "proj_1", environmentId: "env_1", title: "Исходный тред" }),
      spawn: async (args: Record<string, unknown>) => {
        calls.push(args);
        return { id: "thr_new" };
      },
    },
    environments: { get: async () => ({ hostId: "host_src", branchName: "bb/thr_src", path: "/w/thr_src" }) },
    projects: { get: async ({ projectId }: { projectId: string }) => ({ id: projectId, sources }) },
  };
  const result = await handoff({ sdk } as never, { brief, place: "other", route: { tree, branch: "none", projectId: "proj_2" }, text: "Ответ владельца" });
  return { calls, result };
};

describe("передача в другой проект называет хост проекта", () => {
  it("тред заводится в выбранном проекте на хосте его источника по умолчанию", async () => {
    const { calls, result } = await sentTo([source("host_a", false), source("host_b", true)]);
    expect(result).toEqual({ kind: "created", threadId: "thr_new" });
    expect(calls[0]).toMatchObject({ projectId: "proj_2", environment: { type: "host", hostId: "host_b", workspace: { type: "managed-worktree" } } });
  });

  it("чекаут чужого проекта тоже получает хост проекта", async () => {
    const { calls } = await sentTo([source("host_b", true)], "local");
    expect(calls[0]?.environment).toEqual({ type: "host", hostId: "host_b", workspace: { type: "unmanaged", path: null } });
  });

  it("проект без источников — понятный отказ, тред не заводится", async () => {
    const { calls, result } = await sentTo([]);
    expect(calls).toHaveLength(0);
    expect(result).toEqual({ kind: "failed", error: 'the project "proj_2" has no source to host the new thread' });
  });
});

function source(hostId: string, isDefault: boolean): Source {
  return { hostId, isDefault };
}

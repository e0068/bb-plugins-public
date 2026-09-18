// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { handoff } from "./handoff";

const brief: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_src",
  title: "Flow — место исполнения",
  createdAt: "2026-09-16T10:00:00.000Z",
  kind: "brief",
  questions: [],
  setup: { criteria: ["Тесты зелёные"] },
};

const sdk = (options: { branchName?: string | null; environmentId?: string | null; fail?: boolean } = {}) => {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    sdk: {
      threads: {
        get: async () => ({ projectId: "proj_1", environmentId: options.environmentId === undefined ? "env_1" : options.environmentId }),
        spawn: async (args: Record<string, unknown>) => {
          if (options.fail === true) throw new Error("host unavailable");
          calls.push(args);
          return { id: "thr_new" };
        },
      },
      environments: {
        get: async () => ({ hostId: "host_1", path: "/tree", branchName: options.branchName === undefined ? "bb/thr_src" : options.branchName }),
      },
    },
  };
};

describe("передача работы в новый тред", () => {
  it("в новом дереве ветка отводится от ветки исходного треда", async () => {
    const { sdk: fake, calls } = sdk();
    await handoff({ sdk: fake } as never, { brief, place: "worktree", text: "Ответ владельца" });
    expect(calls[0]?.environment).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: "bb/thr_src" } },
    });
  });

  it("без известной ветки новое дерево идёт от ветки проекта по умолчанию", async () => {
    const { sdk: fake, calls } = sdk({ branchName: null });
    await handoff({ sdk: fake } as never, { brief, place: "worktree", text: "Ответ владельца" });
    expect((calls[0]?.environment as { workspace: { baseBranch: unknown } }).workspace.baseBranch).toEqual({ kind: "default" });
  });

  it("первое сообщение несёт ссылку на исходный тред и ответ владельца", async () => {
    const { sdk: fake, calls } = sdk();
    await handoff({ sdk: fake } as never, { brief, place: "thread", text: "Ответ владельца" });
    const input = calls[0]?.input as Array<{ type: string; text: string }>;
    expect(input[0]?.text).toContain("thr_src");
    expect(input[0]?.text).toContain("Ответ владельца");
    expect(calls[0]?.title).toBe("Flow — место исполнения");
  });

  it("тред без окружения не уезжает в то же дерево", async () => {
    const { sdk: fake } = sdk({ environmentId: null });
    expect(await handoff({ sdk: fake } as never, { brief, place: "thread", text: "Ответ" })).toEqual({ kind: "failed", error: "the source thread has no environment" });
  });

  it("сбой хоста возвращается ошибкой, а не бросается", async () => {
    const { sdk: fake } = sdk({ fail: true });
    const result = await handoff({ sdk: fake } as never, { brief, place: "thread", text: "Ответ" });
    expect(result).toEqual({ kind: "failed", error: "host unavailable" });
  });
});

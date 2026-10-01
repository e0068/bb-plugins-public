import { describe, expect, it } from "vitest";
import type { CallerEnvironment } from "./caller-root.js";
import { awaitThreadWorktree } from "./thread-environment.js";

const worktree: CallerEnvironment = {
  environmentId: "env_1",
  projectId: "proj_1",
  path: "/tmp/tree",
  name: "tree",
  branchName: "feature",
  isWorktree: true,
  hostId: "host_1",
};

/** Тред работает в главном чекауте: своего дерева у него нет и не появится. */
const withoutTree: CallerEnvironment = { ...worktree, path: null, isWorktree: false };

function recorder() {
  const slept: number[] = [];
  return { slept, sleep: async (ms: number) => void slept.push(ms) };
}

describe("awaitThreadWorktree", () => {
  it("отдаёт дерево, как только оно появилось, и больше не ждёт", async () => {
    const answers: (CallerEnvironment | null)[] = [null, worktree];
    const { slept, sleep } = recorder();

    const found = await awaitThreadWorktree(async () => answers.shift() ?? null, {
      attempts: 5,
      delayMs: 10,
      sleep,
    });

    expect(found).toBe(worktree);
    expect(slept).toEqual([10]);
  });

  it("дерева так и не появилось — null, и попыток ровно столько, сколько отведено", async () => {
    let calls = 0;
    const { slept, sleep } = recorder();

    const found = await awaitThreadWorktree(
      async () => {
        calls += 1;
        return null;
      },
      { attempts: 3, delayMs: 10, sleep },
    );

    expect(found).toBeNull();
    expect(calls).toBe(3);
    expect(slept).toEqual([10, 10]);
  });

  it("окружение без своего дерева не годится, сколько его ни жди", async () => {
    const { sleep } = recorder();

    const found = await awaitThreadWorktree(async () => withoutTree, {
      attempts: 2,
      delayMs: 1,
      sleep,
    });

    expect(found).toBeNull();
  });
});

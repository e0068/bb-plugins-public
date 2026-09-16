import { describe, expect, it } from "vitest";
import { currentCallerEnvironment, runInCallerScope } from "./caller-scope.js";
import type { CallerEnvironment } from "./caller-root.js";

function env(id: string): CallerEnvironment {
  return {
    environmentId: id,
    projectId: "proj_x",
    path: `/worktrees/${id}`,
    name: id,
    branchName: `bb/${id}`,
    isWorktree: true,
    hostId: "host_1",
  };
}

describe("caller scope", () => {
  it("вне области вызова окружения нет", () => {
    expect(currentCallerEnvironment()).toBeNull();
  });

  it("внутри области виден переданный вызывающий, снаружи он не остаётся", async () => {
    const seen = await runInCallerScope(env("env_1"), async () => currentCallerEnvironment());
    expect(seen?.environmentId).toBe("env_1");
    expect(currentCallerEnvironment()).toBeNull();
  });

  // Две команды из разных тредов идут через один процесс плагина
  // одновременно: общее поле перепутало бы их деревья.
  it("одновременные вызовы не видят чужого окружения", async () => {
    const slow = runInCallerScope(env("env_slow"), async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return currentCallerEnvironment()?.environmentId;
    });
    const fast = runInCallerScope(env("env_fast"), async () =>
      currentCallerEnvironment()?.environmentId,
    );
    expect(await Promise.all([slow, fast])).toEqual(["env_slow", "env_fast"]);
  });

  it("область без вызывающего окружения читается как его отсутствие", async () => {
    expect(await runInCallerScope(null, async () => currentCallerEnvironment())).toBeNull();
  });
});

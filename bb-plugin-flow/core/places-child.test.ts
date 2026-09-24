// @vitest-environment node
import { describe, expect, it } from "vitest";

import { OFFERED_PLACES, isNewThread, offeredPlace, routeEnvironment } from "./places";

const source = { environmentId: "env_1", hostId: "host_1", branchName: "bb/thr_src" };

describe("дочерний тред третьим местом исполнения", () => {
  it("бриф предлагает четыре места: этот тред, новый, дочерний и другой проект", () => {
    expect(OFFERED_PLACES).toEqual(["here", "thread", "child", "other"]);
  });

  it("запомненный «новый worktree» открывается новым тредом", () => {
    expect(offeredPlace("worktree")).toBe("thread");
    expect(offeredPlace("child")).toBe("child");
  });

  it("новый и дочерний тред — оба новые: работа уезжает из этого треда", () => {
    expect(isNewThread("child")).toBe(true);
    expect(isNewThread("thread")).toBe(true);
    expect(isNewThread("here")).toBe(false);
  });

  it("дерево и ветка дочернего треда те же, что у соседнего: место окружения не меняет", () => {
    const route = { tree: "new", branch: "from-current" } as const;
    expect(routeEnvironment("child", route, source)).toEqual({ type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: "bb/thr_src" } } });
  });
});

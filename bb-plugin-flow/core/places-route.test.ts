// @vitest-environment node
import { describe, expect, it } from "vitest";

import { DEFAULT_ROUTE, ROUTE_BRANCHES, branchAllowed, legacyRoute, routeEnvironment, withBranch, withTree } from "./places";

const source = { environmentId: "env_1", hostId: "host_1", branchName: "bb/thr_src" };

describe("маршрут нового треда: дерево и ветка", () => {
  it("по умолчанию — это же дерево и текущая ветка, как прежний «Новый тред»", () => {
    expect(DEFAULT_ROUTE).toEqual({ tree: "same", branch: "current" });
  });

  it("в этом дереве ветка одна — текущая", () => {
    expect(ROUTE_BRANCHES.filter((branch) => branchAllowed("same", branch))).toEqual(["current"]);
  });

  it("новое дерево ветку только отводит: текущую ветку второе дерево не возьмёт, без ветки дерева нет", () => {
    expect(ROUTE_BRANCHES.filter((branch) => branchAllowed("new", branch))).toEqual(["from-current", "from-origin-main", "from-main"]);
  });

  it("локально — отвести ветку или остаться без смены ветки; текущая ветка занята деревом треда", () => {
    expect(ROUTE_BRANCHES.filter((branch) => branchAllowed("local", branch))).toEqual(["from-current", "from-origin-main", "from-main", "none"]);
  });

  it("смена дерева сохраняет ветку, если она там доступна, иначе берёт первую доступную", () => {
    expect(withTree({ tree: "new", branch: "from-main" }, "local")).toEqual({ tree: "local", branch: "from-main" });
    expect(withTree({ tree: "local", branch: "none" }, "new")).toEqual({ tree: "new", branch: "from-current" });
    expect(withTree({ tree: "new", branch: "from-main" }, "same")).toEqual({ tree: "same", branch: "current" });
  });

  it("недоступная ветка не выбирается", () => {
    const route = { tree: "same", branch: "current" } as const;
    expect(withBranch(route, "from-main")).toEqual(route);
    expect(withBranch({ tree: "new", branch: "from-current" }, "from-main")).toEqual({ tree: "new", branch: "from-main" });
  });

  it("старый «новый worktree» читается как новое дерево с веткой от текущей", () => {
    expect(legacyRoute("worktree")).toEqual({ tree: "new", branch: "from-current" });
    expect(legacyRoute("thread")).toEqual(DEFAULT_ROUTE);
  });
});

describe("окружение нового треда по маршруту", () => {
  it("это же дерево переиспользует окружение", () => {
    expect(routeEnvironment(DEFAULT_ROUTE, source)).toEqual({ type: "reuse", environmentId: "env_1" });
  });

  it("новое дерево отводит ветку от текущей, от origin/main или от main", () => {
    const base = (branch: "from-current" | "from-origin-main" | "from-main") => routeEnvironment({ tree: "new", branch }, source);
    expect(base("from-current")).toEqual({ type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: "bb/thr_src" } } });
    expect(base("from-origin-main")).toEqual({ type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: "origin/main" } } });
    expect(base("from-main")).toEqual({ type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: "main" } } });
  });

  it("без известной текущей ветки новое дерево идёт от ветки проекта по умолчанию", () => {
    expect(routeEnvironment({ tree: "new", branch: "from-current" }, { ...source, branchName: null })).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
    });
  });

  it("локально — чекаут проекта: с новой веткой от выбранной или без смены ветки", () => {
    expect(routeEnvironment({ tree: "local", branch: "from-main" }, source)).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: { type: "unmanaged", path: null, branch: { kind: "new", baseBranch: "main" } },
    });
    expect(routeEnvironment({ tree: "local", branch: "none" }, source)).toEqual({ type: "host", hostId: "host_1", workspace: { type: "unmanaged", path: null } });
  });
});

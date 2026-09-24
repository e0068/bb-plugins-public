// @vitest-environment node
import { describe, expect, it } from "vitest";

import { DEFAULT_ROUTE, ROUTE_BRANCHES, legacyRoute, routeAllowed, routeEnvironment, withBranch, withTree } from "./places";

const source = { environmentId: "env_1", hostId: "host_1", branchName: "bb/thr_src" };

describe("маршрут нового треда: дерево и ветка", () => {
  it("по умолчанию — это же дерево и текущая ветка, как прежний «Новый тред»", () => {
    expect(DEFAULT_ROUTE).toEqual({ tree: "same", branch: "current" });
  });

  it("новое дерево ветку только отводит: текущую ветку второе дерево не возьмёт, без ветки дерева нет", () => {
    expect(ROUTE_BRANCHES.filter((branch) => routeAllowed("thread", { tree: "new", branch }))).toEqual(["from-current", "from-origin-main", "from-main"]);
  });

  it("локально — отвести ветку или остаться без смены ветки; текущая ветка занята деревом треда", () => {
    expect(ROUTE_BRANCHES.filter((branch) => routeAllowed("thread", { tree: "local", branch }))).toEqual(["from-current", "from-origin-main", "from-main", "none"]);
  });

  it("старый «новый worktree» читается как новое дерево с веткой от текущей", () => {
    expect(legacyRoute("worktree")).toEqual({ tree: "new", branch: "from-current" });
    expect(legacyRoute("thread")).toEqual(DEFAULT_ROUTE);
  });
});

describe("окружение нового треда по маршруту", () => {
  it("это же дерево переиспользует окружение", () => {
    expect(routeEnvironment("thread", DEFAULT_ROUTE, source)).toEqual({ type: "reuse", environmentId: "env_1" });
  });

  it("новое дерево отводит ветку от текущей, от origin/main или от main", () => {
    const base = (branch: "from-current" | "from-origin-main" | "from-main") => routeEnvironment("thread", { tree: "new", branch }, source);
    expect(base("from-current")).toEqual({ type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: "bb/thr_src" } } });
    expect(base("from-origin-main")).toEqual({ type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: "origin/main" } } });
    expect(base("from-main")).toEqual({ type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: "main" } } });
  });

  it("без известной текущей ветки новое дерево идёт от ветки проекта по умолчанию", () => {
    expect(routeEnvironment("thread", { tree: "new", branch: "from-current" }, { ...source, branchName: null })).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
    });
  });

  it("локально — чекаут проекта: с новой веткой от выбранной или без смены ветки", () => {
    expect(routeEnvironment("thread", { tree: "local", branch: "from-main" }, source)).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: { type: "unmanaged", path: null, branch: { kind: "new", baseBranch: "main" } },
    });
    expect(routeEnvironment("thread", { tree: "local", branch: "none" }, source)).toEqual({ type: "host", hostId: "host_1", workspace: { type: "unmanaged", path: null } });
  });
});

describe("ветки своего проекта", () => {
  it("в дереве треда можно остаться в текущей ветке и отвести новую", () => {
    expect(ROUTE_BRANCHES.filter((branch) => routeAllowed("thread", { tree: "same", branch }))).toEqual(["current", "from-current", "from-origin-main", "from-main"]);
  });

  it("недоступная ветка не выбирается", () => {
    const route = { tree: "same", branch: "current" } as const;
    expect(withBranch(route, "none")).toEqual(route);
    expect(withBranch(route, "from-main")).toEqual({ tree: "same", branch: "from-main" });
    expect(withBranch({ tree: "new", branch: "from-current" }, "current")).toEqual({ tree: "new", branch: "from-current" });
  });

  it("смена дерева сохраняет ветку, если она там доступна, иначе берёт первую доступную", () => {
    expect(withTree({ tree: "new", branch: "from-main" }, "thread", "same")).toEqual({ tree: "same", branch: "from-main" });
    expect(withTree({ tree: "new", branch: "from-main" }, "thread", "local")).toEqual({ tree: "local", branch: "from-main" });
    expect(withTree({ tree: "local", branch: "none" }, "thread", "new")).toEqual({ tree: "new", branch: "from-current" });
    expect(withTree({ tree: "local", branch: "none" }, "thread", "same")).toEqual({ tree: "same", branch: "current" });
  });

  it("отвод ветки в дереве треда идёт тем же деревом с новой веткой", () => {
    expect(routeEnvironment("thread", { tree: "same", branch: "from-current" }, { ...source, path: "/w/thr_src" })).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: { type: "unmanaged", path: "/w/thr_src", branch: { kind: "new", baseBranch: "bb/thr_src" } },
    });
    expect(routeEnvironment("thread", { tree: "same", branch: "from-main" }, { ...source, path: "/w/thr_src" })).toEqual({
      type: "host",
      hostId: "host_1",
      workspace: { type: "unmanaged", path: "/w/thr_src", branch: { kind: "new", baseBranch: "main" } },
    });
  });

  it("без известного пути дерева отвод не делается: окружение переиспользуется", () => {
    expect(routeEnvironment("thread", { tree: "same", branch: "from-main" }, { ...source, path: null })).toEqual({ type: "reuse", environmentId: "env_1" });
    expect(routeEnvironment("thread", { tree: "same", branch: "current" }, { ...source, path: "/w/thr_src" })).toEqual({ type: "reuse", environmentId: "env_1" });
  });
});

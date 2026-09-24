// @vitest-environment node
import { describe, expect, it } from "vitest";

import { routeAllowed, routeEnvironment, treesFor, withPlace, withProject, withTree } from "./places";

const source = { environmentId: "env_1", hostId: "host_1", branchName: "bb/thr_src", path: "/w/thr_src" };

describe("работа в другом проекте", () => {
  it("в чужом проекте дерева этого треда нет: оно принадлежит этому проекту", () => {
    expect(treesFor("other")).toEqual(["new", "local"]);
    expect(treesFor("thread")).toEqual(["same", "new", "local"]);
  });

  it("маршрут чужого проекта возможен только с его деревом, без ветки и с выбранным проектом", () => {
    expect(routeAllowed("other", { tree: "new", branch: "none", projectId: "proj_1" })).toBe(true);
    expect(routeAllowed("other", { tree: "local", branch: "none", projectId: "proj_1" })).toBe(true);
    expect(routeAllowed("other", { tree: "new", branch: "none" })).toBe(false);
    expect(routeAllowed("other", { tree: "same", branch: "none", projectId: "proj_1" })).toBe(false);
    expect(routeAllowed("other", { tree: "new", branch: "from-main", projectId: "proj_1" })).toBe(false);
  });

  it("свой проект проверяется по дереву и ветке, а проект в маршруте ему не нужен", () => {
    expect(routeAllowed("thread", { tree: "same", branch: "from-main" })).toBe(true);
    expect(routeAllowed("thread", { tree: "same", branch: "none" })).toBe(false);
  });

  it("переход в чужой проект берёт его дерево и снимает ветку, храня выбранный проект", () => {
    expect(withPlace({ tree: "same", branch: "current", projectId: "proj_1" }, "other")).toEqual({ tree: "new", branch: "none", projectId: "proj_1" });
    expect(withPlace({ tree: "local", branch: "from-main" }, "other")).toEqual({ tree: "local", branch: "none" });
  });

  it("возврат в свой проект отбрасывает проект и чинит ветку под дерево", () => {
    expect(withPlace({ tree: "local", branch: "none", projectId: "proj_1" }, "thread")).toEqual({ tree: "local", branch: "none" });
    expect(withPlace({ tree: "new", branch: "none", projectId: "proj_1" }, "child")).toEqual({ tree: "new", branch: "from-current" });
  });

  it("смена дерева считается по месту: у чужого проекта ветка остаётся снятой", () => {
    expect(withTree({ tree: "new", branch: "none", projectId: "proj_1" }, "other", "local")).toEqual({ tree: "local", branch: "none", projectId: "proj_1" });
    expect(withTree({ tree: "new", branch: "from-main" }, "thread", "local")).toEqual({ tree: "local", branch: "from-main" });
    expect(withTree({ tree: "new", branch: "none", projectId: "proj_1" }, "other", "same")).toEqual({ tree: "new", branch: "none", projectId: "proj_1" });
  });

  it("проект ставится в маршрут как есть", () => {
    expect(withProject({ tree: "new", branch: "none" }, "proj_2")).toEqual({ tree: "new", branch: "none", projectId: "proj_2" });
  });

  it("новое дерево чужого проекта заводит сам проект: хост этого треда тут ни при чём", () => {
    expect(routeEnvironment("other", { tree: "new", branch: "none", projectId: "proj_1" }, source)).toEqual({
      type: "host",
      workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
    });
  });

  it("чекаут чужого проекта — его рабочая копия, без смены ветки", () => {
    expect(routeEnvironment("other", { tree: "local", branch: "none", projectId: "proj_1" }, source)).toEqual({
      type: "host",
      workspace: { type: "unmanaged", path: null },
    });
  });
});

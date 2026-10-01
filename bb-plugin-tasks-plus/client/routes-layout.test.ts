import { describe, expect, it } from "vitest";
import { parseTasksRoute, tasksRouteToSubPath, type TasksRoute } from "./routes.js";

describe("the address of a task screen names its layout", () => {
  it("every task screen reads its layout from the address", () => {
    expect(parseTasksRoute("all?view=board")).toEqual({ kind: "all", view: "board" });
    expect(parseTasksRoute("active?view=table")).toEqual({ kind: "active", view: "table" });
    expect(parseTasksRoute("waiting?view=board")).toEqual({ kind: "waiting", view: "board" });
    expect(parseTasksRoute("P1?view=board")).toEqual({ kind: "project", projectId: "P1", view: "board" });
    expect(parseTasksRoute("all")).toEqual({ kind: "all", view: null });
    expect(parseTasksRoute("")).toEqual({ kind: "all", view: null });
    expect(parseTasksRoute("P1")).toEqual({ kind: "project", projectId: "P1", view: null });
    expect(parseTasksRoute("all?view=grid")).toEqual({ kind: "all", view: null });
  });

  it("a list address opens the table", () => {
    expect(parseTasksRoute("P1?view=list")).toEqual({ kind: "project", projectId: "P1", view: "table" });
    expect(parseTasksRoute("active?view=list")).toEqual({ kind: "active", view: "table" });
  });

  it("parse after build returns the route", () => {
    const routes: TasksRoute[] = [
      { kind: "all", view: null },
      { kind: "all", view: "board" },
      { kind: "active", view: "table" },
      { kind: "waiting", view: null },
      { kind: "project", projectId: "P1", view: "board" },
      { kind: "project", projectId: "P1", view: null },
      { kind: "view", savedViewId: "V1" },
      { kind: "task", taskKey: "TSK-1" },
      { kind: "manage" },
      { kind: "analytics" },
    ];
    for (const route of routes) expect(parseTasksRoute(tasksRouteToSubPath(route))).toEqual(route);
    expect(tasksRouteToSubPath({ kind: "all", view: null })).toBe("all");
    expect(tasksRouteToSubPath({ kind: "all", view: "board" })).toBe("all?view=board");
  });

  it("an address without an id falls back to All tasks, laid out as remembered", () => {
    expect(parseTasksRoute("view")).toEqual({ kind: "all", view: null });
    expect(parseTasksRoute("task")).toEqual({ kind: "all", view: null });
  });
});

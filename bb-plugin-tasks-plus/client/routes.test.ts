import { describe, expect, it } from "vitest";

import { parseTasksRoute, type TasksRoute, tasksRouteToSubPath } from "./routes";

// The analytics route (BBPL-259) round-trips through the subPath grammar like
// every other flat route.
const flatRoutes: TasksRoute[] = [
  { kind: "all" },
  { kind: "active" },
  { kind: "waiting" },
  { kind: "manage" },
  { kind: "analytics" },
];

describe("analytics route", () => {
  it("parses the 'analytics' segment", () => {
    expect(parseTasksRoute("analytics")).toEqual({ kind: "analytics" });
  });

  it("encodes to the 'analytics' segment", () => {
    expect(tasksRouteToSubPath({ kind: "analytics" })).toBe("analytics");
  });

  it("round-trips every flat route through encode → parse", () => {
    for (const route of flatRoutes) {
      expect(parseTasksRoute(tasksRouteToSubPath(route))).toEqual(route);
    }
  });
});

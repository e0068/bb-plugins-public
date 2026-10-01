import { describe, expect, it } from "vitest";

import { parseTasksRoute, tasksRouteToSubPath } from "./routes";

describe("analytics route", () => {
  it("parses the 'analytics' segment", () => {
    expect(parseTasksRoute("analytics")).toEqual({ kind: "analytics" });
  });

  it("encodes to the 'analytics' segment", () => {
    expect(tasksRouteToSubPath({ kind: "analytics" })).toBe("analytics");
  });

});

describe("saved view route", () => {
  it("reads a view address", () => {
    expect(parseTasksRoute("view/01J0000000000000000000000A")).toEqual({
      kind: "view",
      savedViewId: "01J0000000000000000000000A",
    });
  });

  it("writes a view address", () => {
    expect(
      tasksRouteToSubPath({
        kind: "view",
        savedViewId: "01J0000000000000000000000A",
      }),
    ).toBe("view/01J0000000000000000000000A");
  });

  it("round-trips a view address", () => {
    const route = {
      kind: "view" as const,
      savedViewId: "01J0000000000000000000000A",
    };
    expect(parseTasksRoute(tasksRouteToSubPath(route))).toEqual(route);
  });
});

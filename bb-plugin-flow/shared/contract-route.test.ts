// @vitest-environment node
import { describe, expect, it } from "vitest";

import { dispatchPlaceSchema, dispatchRouteSchema, dispatchRpcContract } from "./contract";

describe("маршрут с чужим проектом", () => {
  it("маршрут прежнего вида читается без projectId", () => {
    const route = dispatchRouteSchema.parse({ tree: "same", branch: "current" });
    expect(route).toEqual({ tree: "same", branch: "current" });
  });

  it("маршрут с чужим проектом хранит projectId", () => {
    expect(dispatchRouteSchema.parse({ tree: "new", branch: "none", projectId: "proj_1" })).toEqual({ tree: "new", branch: "none", projectId: "proj_1" });
  });

  it("чужой проект — место, а не дерево", () => {
    expect(dispatchPlaceSchema.safeParse("other").success).toBe(true);
    expect(dispatchRouteSchema.safeParse({ tree: "other", branch: "none" }).success).toBe(false);
  });

  it("listProjects отдаёт список проектов или отказ", () => {
    const { output } = dispatchRpcContract.listProjects;
    expect(output.parse({ kind: "found", projects: [{ id: "proj_1", name: "Cellular" }] })).toEqual({ kind: "found", projects: [{ id: "proj_1", name: "Cellular" }] });
    expect(output.parse({ kind: "unavailable" })).toEqual({ kind: "unavailable" });
    expect(output.safeParse({ projects: [] }).success).toBe(false);
  });
});

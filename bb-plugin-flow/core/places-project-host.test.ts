// @vitest-environment node
import { describe, expect, it } from "vitest";

import { projectHost, routeEnvironment } from "./places";

/** Для чужого проекта в источник маршрута кладётся хост выбранного проекта. */
const target = { environmentId: "env_1", hostId: "host_2", branchName: null };

const source = (hostId: string, isDefault: boolean) => ({ hostId, isDefault });

describe("хост треда в другом проекте", () => {
  it("новое дерево чужого проекта заводится на хосте проекта от его ветки по умолчанию", () => {
    expect(routeEnvironment("other", { tree: "new", branch: "none", projectId: "proj_2" }, target)).toEqual({
      type: "host",
      hostId: "host_2",
      workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
    });
  });

  it("чекаут чужого проекта — его рабочая копия на хосте проекта, без смены ветки", () => {
    expect(routeEnvironment("other", { tree: "local", branch: "none", projectId: "proj_2" }, target)).toEqual({
      type: "host",
      hostId: "host_2",
      workspace: { type: "unmanaged", path: null },
    });
  });

  it("хост проекта — хост его источника по умолчанию, где бы тот ни стоял в списке", () => {
    expect(projectHost([source("host_a", false), source("host_b", true)])).toBe("host_b");
  });

  it("без источника по умолчанию хост берётся у первого источника", () => {
    expect(projectHost([source("host_a", false), source("host_b", false)])).toBe("host_a");
  });

  it("у проекта без источников хоста нет", () => {
    expect(projectHost([])).toBeUndefined();
  });
});

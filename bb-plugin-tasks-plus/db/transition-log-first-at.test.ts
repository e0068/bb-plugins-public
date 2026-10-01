import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createTransitionLog } from "./transition-log.js";

function newLog() {
  return createTransitionLog(createFakePluginHost({ pluginId: "tasks-plus" }).bb.storage.database());
}

describe("transition log — where it starts", () => {
  it("has no start while nothing is recorded", () => {
    expect(newLog().firstAtMs()).toBeNull();
  });

  it("starts at the earliest recorded change, whatever order they were written in", () => {
    const log = newLog();
    log.record({ taskId: "A", projectId: "P", fromStatus: null, toStatus: "done", atMs: 5000, actor: null });
    log.record({ taskId: "B", projectId: "P", fromStatus: null, toStatus: "todo", atMs: 2000, actor: null });
    expect(log.firstAtMs()).toBe(2000);
  });
});

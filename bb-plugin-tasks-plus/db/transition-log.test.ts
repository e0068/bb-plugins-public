import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createTransitionLog, type StatusTransition } from "./transition-log.js";

function newLog() {
  const host = createFakePluginHost({ pluginId: "tasks-plus" });
  return { host, log: createTransitionLog(host.bb.storage.database()) };
}

function transition(over: Partial<StatusTransition> = {}): StatusTransition {
  return {
    taskId: "BBPL-1",
    projectId: "BBPL",
    fromStatus: "todo",
    toStatus: "in_progress",
    atMs: 1000,
    actor: "me",
    ...over,
  };
}

describe("transition log — record & range", () => {
  it("returns a recorded transition inside the queried window", () => {
    const { log } = newLog();
    log.record(transition());
    expect(log.range(0, 2000)).toEqual([transition()]);
  });

  it("treats the window as [from, to): the from bound includes, the to bound excludes", () => {
    const { log } = newLog();
    log.record(transition({ atMs: 1000 }));
    expect(log.range(1000, 1001)).toHaveLength(1);
    expect(log.range(0, 1000)).toHaveLength(0);
    expect(log.range(1001, 2000)).toHaveLength(0);
  });

  it("orders rows oldest first", () => {
    const { log } = newLog();
    log.record(transition({ taskId: "late", atMs: 300 }));
    log.record(transition({ taskId: "early", atMs: 100 }));
    log.record(transition({ taskId: "mid", atMs: 200 }));
    expect(log.range(0, 1000).map((r) => r.taskId)).toEqual(["early", "mid", "late"]);
  });

  it("filters by project when asked, ignores it when not", () => {
    const { log } = newLog();
    log.record(transition({ projectId: "BBPL", atMs: 100 }));
    log.record(transition({ projectId: "OTHER", atMs: 200 }));
    expect(log.range(0, 1000, { projectId: "BBPL" }).map((r) => r.projectId)).toEqual(["BBPL"]);
    expect(log.range(0, 1000).map((r) => r.projectId)).toEqual(["BBPL", "OTHER"]);
  });

  it("records a first-appearance transition whose fromStatus is null", () => {
    const { log } = newLog();
    log.record(transition({ fromStatus: null, toStatus: "backlog", atMs: 50 }));
    expect(log.range(0, 100)[0].fromStatus).toBeNull();
  });

  it("records a transition with no actor", () => {
    const { log } = newLog();
    log.record(transition({ actor: null }));
    expect(log.range(0, 2000)[0].actor).toBeNull();
  });

  it("returns nothing for an empty window", () => {
    const { log } = newLog();
    log.record(transition({ atMs: 5000 }));
    expect(log.range(0, 1000)).toEqual([]);
  });

  it("breaks ties on equal timestamps by insertion order", () => {
    const { log } = newLog();
    log.record(transition({ taskId: "first", atMs: 100 }));
    log.record(transition({ taskId: "second", atMs: 100 }));
    expect(log.range(0, 1000).map((r) => r.taskId)).toEqual(["first", "second"]);
  });

  it("returns nothing for an inverted window", () => {
    const { log } = newLog();
    log.record(transition({ atMs: 500 }));
    expect(log.range(2000, 1000)).toEqual([]);
  });
});

describe("transition log — persistence", () => {
  it("keeps rows across a reopen of the same database", () => {
    const host = createFakePluginHost({ pluginId: "tasks-plus" });
    createTransitionLog(host.bb.storage.database()).record(transition());
    expect(createTransitionLog(host.bb.storage.database()).range(0, 2000)).toHaveLength(1);
  });
});

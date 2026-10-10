import { describe, expect, it } from "vitest";

import { parseTasksRoute, rememberedSubPath, tasksRouteToSubPath, threadTasksRoute } from "./routes";

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

describe("all tasks of one thread", () => {
  it("reads the thread from the all-tasks address, with or without a layout", () => {
    expect(parseTasksRoute("all?thread=thr_1")).toEqual({ kind: "all", view: null, thread: "thr_1" });
    expect(parseTasksRoute("all%3Fview%3Dboard%26thread%3Dthr_1")).toEqual({ kind: "all", view: "board", thread: "thr_1" });
  });

  it("writes it back the same way; plain all tasks keeps its address", () => {
    expect(tasksRouteToSubPath({ kind: "all", view: null, thread: "thr_1" })).toBe("all?thread=thr_1");
    expect(tasksRouteToSubPath({ kind: "all", view: "board", thread: "thr_1" })).toBe("all?view=board&thread=thr_1");
    expect(tasksRouteToSubPath({ kind: "all", view: null })).toBe("all");
  });
});

describe("threadTasksRoute", () => {
  it("a thread's single task opens that task", () => {
    expect(threadTasksRoute("thr_1", [{ key: "TSK-4" }])).toEqual({ kind: "task", taskKey: "TSK-4" });
  });

  it("several tasks open all tasks narrowed to the thread", () => {
    expect(threadTasksRoute("thr_1", [{ key: "TSK-4" }, { key: "TSK-5" }])).toEqual({ kind: "all", view: null, thread: "thr_1" });
  });

  it("a thread without tasks leaves the page where it is", () => {
    expect(threadTasksRoute("thr_1", [])).toBeNull();
  });
});

describe("rememberedSubPath", () => {
  it("all tasks of a thread is remembered as all tasks, its layout kept", () => {
    expect(rememberedSubPath("all?thread=thr_1")).toBe("all");
    expect(rememberedSubPath("all?view=board&thread=thr_1")).toBe("all?view=board");
  });

  it("every other address is remembered as it is, the empty root too", () => {
    for (const subPath of ["", "all", "task/TSK-4", "01HZZZZZZZZZZZZZZZZZZZZZP1?view=board"]) {
      expect(rememberedSubPath(subPath)).toBe(subPath);
    }
  });
});

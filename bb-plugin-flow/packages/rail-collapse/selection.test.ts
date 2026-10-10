// @vitest-environment node
import { describe, expect, it } from "vitest";

import { NO_SELECTION, followStep, isPlainClick, leave, markedThread, pick, routed, threadOfPath, visit } from "./selection";

const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

describe("visit and pick", () => {
  it("opening a thread selects it without counting as a pick", () => {
    expect(visit(NO_SELECTION, "thr_1")).toEqual({ threadId: "thr_1", picks: 0 });
  });

  it("opening the selected thread again changes nothing", () => {
    const selected = visit(NO_SELECTION, "thr_1");
    expect(visit(selected, "thr_1")).toBe(selected);
  });

  it("every pick counts, the same thread too", () => {
    const once = pick(visit(NO_SELECTION, "thr_1"), "thr_1");
    expect(once).toEqual({ threadId: "thr_1", picks: 1 });
    expect(pick(once, "thr_1").picks).toBe(2);
  });
});

describe("isPlainClick", () => {
  it("a left click without modifiers is plain", () => {
    expect(isPlainClick(plain)).toBe(true);
  });

  it("another button or any modifier keeps bb's own meaning", () => {
    expect(isPlainClick({ ...plain, button: 1 })).toBe(false);
    for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      expect(isPlainClick({ ...plain, [key]: true })).toBe(false);
    }
  });
});

describe("leave", () => {
  it("a page that is neither a thread nor a following plugin's drops the thread, keeping the count of picks", () => {
    expect(leave(pick(NO_SELECTION, "thr_1"))).toEqual({ threadId: null, picks: 1 });
  });

  it("with nothing selected there is nothing to drop", () => {
    expect(leave(NO_SELECTION)).toBe(NO_SELECTION);
  });
});

describe("threadOfPath", () => {
  it("bb's thread page names its thread", () => {
    expect(threadOfPath("/threads/thr_1")).toBe("thr_1");
    expect(threadOfPath("/threads/thr_1/")).toBe("thr_1");
  });

  it("a thread of a project lives under the project, and names its thread too", () => {
    expect(threadOfPath("/projects/proj_abc/threads/thr_1")).toBe("thr_1");
    expect(threadOfPath("/projects/proj_abc/threads/thr_1/files")).toBe("thr_1");
  });

  it("any other page names none", () => {
    expect(threadOfPath("/")).toBeNull();
    expect(threadOfPath("/threads")).toBeNull();
    expect(threadOfPath("/plugins/flow/flows")).toBeNull();
    expect(threadOfPath("/plugins/flow/threads/thr_1")).toBeNull();
    expect(threadOfPath("/projects/proj_abc")).toBeNull();
  });
});

describe("routed", () => {
  const selected = visit(NO_SELECTION, "thr_1");

  it("a thread page selects its thread", () => {
    expect(routed(NO_SELECTION, "/threads/thr_2", ["flow"])).toEqual({ threadId: "thr_2", picks: 0 });
    expect(routed(NO_SELECTION, "/projects/proj_abc/threads/thr_3", ["flow"])).toEqual({ threadId: "thr_3", picks: 0 });
  });

  it("a following plugin's page keeps the thread — it is the thread the owner came from", () => {
    expect(routed(selected, "/plugins/flow/flows", ["flow"])).toBe(selected);
  });

  it("any other page — home, settings, a plugin that does not follow — drops it", () => {
    expect(routed(selected, "/", ["flow"]).threadId).toBeNull();
    expect(routed(selected, "/plugins/tasks-plus/tasks", ["flow"]).threadId).toBeNull();
  });
});

describe("markedThread", () => {
  const selected = visit(NO_SELECTION, "thr_1");

  it("on a following plugin's page the selected thread is the one to mark in the threads panel", () => {
    expect(markedThread(selected, "/plugins/flow/flows/flow_1", ["flow"])).toBe("thr_1");
  });

  it("a thread page is marked by bb itself, and any other page marks nothing", () => {
    expect(markedThread(selected, "/threads/thr_1", ["flow"])).toBeNull();
    expect(markedThread(selected, "/plugins/tasks-plus/tasks", ["flow"])).toBeNull();
    expect(markedThread(selected, "/", ["flow"])).toBeNull();
  });

  it("with no thread selected nothing is marked", () => {
    expect(markedThread(NO_SELECTION, "/plugins/flow/flows", ["flow"])).toBeNull();
  });
});

describe("followStep", () => {
  const selected = visit(NO_SELECTION, "thr_1");

  it("a page entered at its root opens the selected thread once, as an entry", () => {
    expect(followStep(null, true, selected)).toEqual({ kind: "entry", threadId: "thr_1" });
    expect(followStep(0, true, selected)).toBeNull();
  });

  it("a page entered by a deep link keeps its own item", () => {
    expect(followStep(null, false, selected)).toBeNull();
  });

  it("with no thread selected the page stays as it is", () => {
    expect(followStep(null, true, NO_SELECTION)).toBeNull();
  });

  it("a pick after the page opened switches it, whatever the entry", () => {
    expect(followStep(0, false, pick(selected, "thr_2"))).toEqual({ kind: "pick", threadId: "thr_2" });
    expect(followStep(1, false, pick(selected, "thr_2"))).toBeNull();
  });
});

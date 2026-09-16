import { describe, expect, it } from "vitest";
import { needsTerminalComment, terminalCommentBody } from "./terminal-comment.js";

const body = terminalCommentBody({ title: "Work", threadId: "thr_x" }, "completed");

describe("terminalCommentBody", () => {
  it("names the thread, how it ended and which thread it was", () => {
    expect(body).toBe('Thread "Work" completed — final message posted · thr_x');
  });

  it("tells a failure apart from a completion", () => {
    expect(terminalCommentBody({ title: "Work", threadId: "thr_x" }, "failed")).toContain("failed");
  });
});

describe("needsTerminalComment", () => {
  it("asks for the comment when the task has none like it", () => {
    expect(needsTerminalComment([{ body: "Dispatched to Opus" }], body)).toBe(true);
  });

  // The guard used to be the persisted liveStatus; live state now lives in
  // process memory, so a plugin restart would repost without this.
  it("stays quiet when the same report is already on the task", () => {
    expect(needsTerminalComment([{ body: "Dispatched to Opus" }, { body }], body)).toBe(false);
  });

  it("tells reports of different threads apart", () => {
    const other = terminalCommentBody({ title: "Work", threadId: "thr_y" }, "completed");
    expect(needsTerminalComment([{ body: other }], body)).toBe(true);
  });
});

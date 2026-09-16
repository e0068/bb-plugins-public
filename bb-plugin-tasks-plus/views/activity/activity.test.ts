import { describe, expect, it } from "vitest";
import type { DisplayComment } from "../../shared/contract.js";
import {
  commentByline,
  splitSystemBody,
} from "./time.js";

describe("splitSystemBody", () => {
  it("bolds the trailing author of a server system comment", () => {
    expect(splitSystemBody("Status changed to Done by You", "You")).toEqual([
      { text: "Status changed to Done by ", bold: false },
      { text: "You", bold: true },
    ]);
  });

  it("leaves bodies without the by-author suffix untouched", () => {
    expect(splitSystemBody("Task attached to thread", "You")).toEqual([
      { text: "Task attached to thread", bold: false },
    ]);
  });

  it("does not bold when the author only appears mid-sentence", () => {
    expect(splitSystemBody("You changed the status", "You")).toEqual([
      { text: "You changed the status", bold: false },
    ]);
  });
});

describe("commentByline", () => {
  const base: DisplayComment = {
    id: "01HZZZZZZZZZZZZZZZZZZZZZC1",
    taskId: "01HZZZZZZZZZZZZZZZZZZZZZT1",
    kind: "agent",
    authorName: "agent (thr_worker)",
    presetName: null,
    threadId: "thr_worker",
    threadTitle: "Fix the login bug",
    provider: { id: "codex", name: "Codex", logoUrl: null },
    body: "Done",
    notifiedCount: 0,
    createdAt: "2026-07-15T00:00:00.000Z",
  };

  it("links an agent comment to its thread by the resolved human title", () => {
    expect(commentByline(base)).toEqual({
      kind: "thread-link",
      threadId: "thr_worker",
      title: "Fix the login bug",
    });
  });

  it("falls back to the author name when the thread title is unresolved", () => {
    expect(commentByline({ ...base, threadTitle: null })).toEqual({
      kind: "text",
      name: "agent (thr_worker)",
    });
  });

  it("falls back to the author name for legacy agent comments with no thread", () => {
    expect(
      commentByline({ ...base, threadId: null, threadTitle: null }),
    ).toEqual({ kind: "text", name: "agent (thr_worker)" });
  });

  it("never links user comments even if a thread id is present", () => {
    expect(
      commentByline({
        ...base,
        kind: "user",
        authorName: "You",
        threadTitle: "Should be ignored",
      }),
    ).toEqual({ kind: "text", name: "You" });
  });
});

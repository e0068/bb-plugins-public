import { describe, expect, it } from "vitest";
import {
  UNKNOWN_THREAD_LIVE_STATE,
  parseAttachedThreads,
  patchLiveState,
  sameLiveState,
  serializeAttachedThread,
  threadLiveState,
  withLiveState,
  type AttachedThread,
  type ObservedThread,
} from "./live-state.js";

const observed = (over: Partial<ObservedThread> = {}): ObservedThread => ({
  status: "idle",
  archivedAt: null,
  deletedAt: null,
  ...over,
});

const attached = (over: Partial<AttachedThread> = {}): AttachedThread => ({
  id: "01M1RRTTAVH4BJ04DT4BEQ0ZWR",
  taskId: "board:slug",
  threadId: "thr_5xdu44p3zr",
  presetName: "Attached",
  title: "Some thread",
  attachedAt: "2026-09-05T12:31:28.091Z",
  ...over,
});

describe("threadLiveState", () => {
  it.each([
    ["starting", "starting"],
    ["active", "working"],
    ["stopping", "working"],
    ["idle", "idle"],
    ["error", "failed"],
  ] as const)("reads %s as %s", (status, liveStatus) => {
    expect(threadLiveState(observed({ status })).liveStatus).toBe(liveStatus);
  });

  it("reads a deleted thread as completed whatever its status says", () => {
    expect(
      threadLiveState(observed({ status: "error", deletedAt: 1_756_000_000_000 })).liveStatus,
    ).toBe("completed");
  });

  it("reports archival as a timestamp beside the live status, not instead of it", () => {
    expect(threadLiveState(observed({ status: "active", archivedAt: 1_756_000_000_000 }))).toEqual({
      liveStatus: "working",
      archivedAt: new Date(1_756_000_000_000).toISOString(),
    });
  });

  it("leaves archivedAt null for a thread nobody archived", () => {
    expect(threadLiveState(observed()).archivedAt).toBeNull();
  });
});

describe("withLiveState", () => {
  it("joins the attachment fact with the observed state", () => {
    const thread = withLiveState(attached(), { liveStatus: "working", archivedAt: null });
    expect(thread).toEqual({ ...attached(), liveStatus: "working", archivedAt: null });
  });

  it("falls back to the unknown state when the thread has not been observed yet", () => {
    expect(withLiveState(attached())).toEqual({ ...attached(), ...UNKNOWN_THREAD_LIVE_STATE });
  });
});

describe("serializeAttachedThread", () => {
  it("writes the attachment fact and nothing else", () => {
    expect(serializeAttachedThread(attached())).toEqual({
      id: "01M1RRTTAVH4BJ04DT4BEQ0ZWR",
      threadId: "thr_5xdu44p3zr",
      presetName: "Attached",
      title: "Some thread",
      attachedAt: "2026-09-05T12:31:28.091Z",
    });
  });

  it("round-trips through the file shape", () => {
    const thread = attached();
    expect(
      parseAttachedThreads(thread.taskId, { threads: [serializeAttachedThread(thread)] }),
    ).toEqual([thread]);
  });
});

describe("parseAttachedThreads", () => {
  it("takes the task id from the file it read, not from the entry", () => {
    expect(
      parseAttachedThreads("board:actual", {
        threads: [{ ...serializeAttachedThread(attached()), taskId: "board:stale" }],
      })[0]!.taskId,
    ).toBe("board:actual");
  });

  it("drops volatile fields left in the file by an older version", () => {
    const [thread] = parseAttachedThreads("board:slug", {
      threads: [
        {
          ...serializeAttachedThread(attached()),
          liveStatus: "working",
          archivedAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });
    expect(thread).toEqual(attached());
  });

  it("skips entries without an id or a thread id, and a missing block", () => {
    expect(parseAttachedThreads("board:slug", { threads: [{ threadId: "thr_a" }, { id: "x" }] })).toEqual([]);
    expect(parseAttachedThreads("board:slug", {})).toEqual([]);
    expect(parseAttachedThreads("board:slug", { threads: "nonsense" })).toEqual([]);
  });

  it("defaults the text fields it cannot read to empty strings", () => {
    expect(parseAttachedThreads("board:slug", { threads: [{ id: "x", threadId: "thr_a" }] })).toEqual([
      { id: "x", taskId: "board:slug", threadId: "thr_a", presetName: "", title: "", attachedAt: "" },
    ]);
  });
});

describe("patchLiveState", () => {
  it("keeps what the event did not mention", () => {
    expect(
      patchLiveState({ liveStatus: "working", archivedAt: "2026-01-01T00:00:00.000Z" }, { liveStatus: "idle" }),
    ).toEqual({ liveStatus: "idle", archivedAt: "2026-01-01T00:00:00.000Z" });
  });

  it("starts from the unknown state when the thread was never observed", () => {
    expect(patchLiveState(undefined, { archivedAt: "2026-01-01T00:00:00.000Z" })).toEqual({
      liveStatus: "idle",
      archivedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("un-archives when told the thread is no longer archived", () => {
    expect(
      patchLiveState({ liveStatus: "idle", archivedAt: "2026-01-01T00:00:00.000Z" }, { archivedAt: null }),
    ).toEqual({ liveStatus: "idle", archivedAt: null });
  });
});

describe("sameLiveState", () => {
  it("is true only when both halves match", () => {
    const state = { liveStatus: "idle", archivedAt: null } as const;
    expect(sameLiveState(state, { liveStatus: "idle", archivedAt: null })).toBe(true);
    expect(sameLiveState(state, { liveStatus: "working", archivedAt: null })).toBe(false);
    expect(sameLiveState(state, { liveStatus: "idle", archivedAt: "2026-01-01T00:00:00.000Z" })).toBe(false);
  });

  it("counts a never-observed thread as different from any state", () => {
    expect(sameLiveState(undefined, { liveStatus: "idle", archivedAt: null })).toBe(false);
  });
});

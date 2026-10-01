import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planned } from "../test-support/planned.js";
import { TASK_STATUSES, type TaskStatus } from "./enums.js";

const claimPath = "./task-claim.js";
const claim = await planned<typeof import("./task-claim.js")>(() => import(/* @vite-ignore */ claimPath));
const { claimDecision, nextTakenBy, describeTakenBy, formatTakenAgo, claimOnWrite } = claim;

type TakenBy = import("./task-claim.js").TakenBy;

const NOW = new Date("2026-09-30T12:00:03.000Z");
const mark = (machine: string, threadId: string | null = "thr_x"): TakenBy => ({ machine, threadId, at: "2026-09-30T12:00:00.000Z" });

const statusArb = fc.constantFrom<TaskStatus>(...TASK_STATUSES);
const machineArb = fc.constantFrom("Mac mini", "MacBook", "studio");
const markArb = fc.option(fc.record({ machine: machineArb, threadId: fc.option(fc.constantFrom("thr_a", "thr_b"), { nil: null }), at: fc.constant("2026-09-30T12:00:00.000Z") }), { nil: null });

describe("claimDecision — can this machine take the task", () => {
  it("refuses exactly when the task is in progress or in review and another machine holds it", () => {
    fc.assert(
      fc.property(statusArb, markArb, machineArb, (status, takenBy, me) => {
        const decision = claimDecision({ status, takenBy }, me);
        const refused = (status === "in_progress" || status === "in_review") && takenBy !== null && takenBy.machine !== me;
        expect(typeof decision === "object").toBe(refused);
        if (refused) expect(decision).toEqual({ taken: takenBy });
      }),
    );
  });

  it("calls the task mine when this machine holds it, and free when nobody does", () => {
    expect(claimDecision({ status: "in_progress", takenBy: mark("Mac mini") }, "Mac mini")).toBe("mine");
    expect(claimDecision({ status: "todo", takenBy: null }, "Mac mini")).toBe("free");
  });

  it("refuses a task another machine holds in review", () => {
    expect(claimDecision({ status: "in_review", takenBy: mark("MacBook") }, "Mac mini")).toEqual({ taken: mark("MacBook") });
  });

  it("lets a done task held by another machine be taken again", () => {
    expect(claimDecision({ status: "done", takenBy: mark("MacBook") }, "Mac mini")).not.toHaveProperty("taken");
  });

  it("reads a task without the field as free", () => {
    expect(claimDecision({ status: "in_progress", takenBy: undefined }, "Mac mini")).toBe("free");
  });
});

describe("nextTakenBy — the mark a write leaves on the task", () => {
  it("taking a free task stamps this machine, the thread and the time", () => {
    const next = nextTakenBy({ status: "todo", takenBy: null }, { status: "in_progress", threadAttached: false }, "Mac mini", null, NOW);
    expect(next).toEqual({ machine: "Mac mini", threadId: null, at: NOW.toISOString() });
  });

  it("attaching a thread takes the task even without a status change", () => {
    const next = nextTakenBy({ status: "in_progress", takenBy: null }, { status: "in_progress", threadAttached: true }, "Mac mini", "thr_new", NOW);
    expect(next).toEqual({ machine: "Mac mini", threadId: "thr_new", at: NOW.toISOString() });
  });

  it("taking a task this machine already holds keeps the first mark", () => {
    const before = mark("Mac mini", "thr_first");
    const next = nextTakenBy({ status: "in_progress", takenBy: before }, { status: "in_progress", threadAttached: true }, "Mac mini", "thr_second", NOW);
    expect(next).toEqual(before);
  });

  it("going back to backlog or todo always clears the mark", () => {
    fc.assert(
      fc.property(statusArb, markArb, fc.constantFrom<TaskStatus>("backlog", "todo"), fc.boolean(), (from, takenBy, to, threadAttached) => {
        expect(nextTakenBy({ status: from, takenBy }, { status: to, threadAttached }, "Mac mini", "thr_a", NOW)).toBeNull();
      }),
    );
  });

  it("never rewrites another machine's mark", () => {
    fc.assert(
      fc.property(statusArb, statusArb.filter((s) => s !== "backlog" && s !== "todo"), fc.boolean(), (from, to, threadAttached) => {
        const other = mark("MacBook");
        const next = nextTakenBy({ status: from, takenBy: other }, { status: to, threadAttached }, "Mac mini", "thr_a", NOW);
        if (next !== null && next.machine === "MacBook") expect(next).toEqual(other);
        if (from === "in_progress" || from === "in_review") expect(next).toEqual(other);
      }),
    );
  });

  it("done and canceled keep the mark as history", () => {
    const before = mark("Mac mini");
    for (const status of ["done", "canceled"] as const) {
      expect(nextTakenBy({ status: "in_progress", takenBy: before }, { status, threadAttached: false }, "Mac mini", null, NOW)).toEqual(before);
    }
  });

  it("an edit that takes nothing leaves the mark as it was", () => {
    expect(nextTakenBy({ status: "todo", takenBy: null }, { status: "todo", threadAttached: false }, "Mac mini", null, NOW)).toBeNull();
    expect(nextTakenBy({ status: "done", takenBy: mark("MacBook") }, { status: "done", threadAttached: false }, "Mac mini", null, NOW)).toEqual(mark("MacBook"));
  });
});

describe("describeTakenBy — the refusal the CLI and the board show", () => {
  it("names the key, the machine, the thread and how long ago", () => {
    expect(describeTakenBy("BBPL-415", mark("Mac mini", "thr_x"), NOW)).toBe("BBPL-415 is already taken on Mac mini in thread thr_x, 3 s ago");
  });

  it("leaves the thread out when the mark has none", () => {
    expect(describeTakenBy("BBPL-415", mark("Mac mini", null), NOW)).toBe("BBPL-415 is already taken on Mac mini, 3 s ago");
  });

  it("says how long ago in seconds, minutes, hours and days", () => {
    const at = "2026-09-30T12:00:00.000Z";
    expect(formatTakenAgo(at, new Date("2026-09-30T12:00:03.000Z"))).toBe("3 s ago");
    expect(formatTakenAgo(at, new Date("2026-09-30T12:05:00.000Z"))).toBe("5 min ago");
    expect(formatTakenAgo(at, new Date("2026-09-30T14:00:00.000Z"))).toBe("2 h ago");
    expect(formatTakenAgo(at, new Date("2026-10-03T12:00:00.000Z"))).toBe("3 d ago");
  });
});

describe("claimOnWrite — the rule a write of the store follows", () => {
  const request = (status: TaskStatus | undefined, attachesThread = false, threadId: string | null = null) => ({ status, attachesThread, threadId });

  it("asking for In Progress on a task another machine holds is refused with that machine's mark", () => {
    expect(claimOnWrite({ status: "in_progress", takenBy: mark("MacBook") }, request("in_progress"), "Mac mini", NOW)).toEqual({ ok: false, takenBy: mark("MacBook") });
  });

  it("attaching a thread to a task another machine holds in review is refused", () => {
    expect(claimOnWrite({ status: "in_review", takenBy: mark("MacBook") }, request(undefined, true, "thr_new"), "Mac mini", NOW)).toMatchObject({ ok: false });
  });

  it("an edit that takes nothing goes through and keeps the other machine's mark", () => {
    expect(claimOnWrite({ status: "in_progress", takenBy: mark("MacBook") }, request(undefined), "Mac mini", NOW)).toEqual({ ok: true, takenBy: mark("MacBook") });
  });

  it("taking a free task goes through with this machine's new mark", () => {
    expect(claimOnWrite({ status: "todo", takenBy: null }, request("in_progress", false), "Mac mini", NOW)).toEqual({
      ok: true,
      takenBy: { machine: "Mac mini", threadId: null, at: NOW.toISOString() },
    });
  });

  it("is refused exactly when the write takes the task and claimDecision refuses", () => {
    fc.assert(
      fc.property(statusArb, markArb, fc.option(statusArb, { nil: undefined }), fc.boolean(), machineArb, (status, takenBy, asked, attachesThread, me) => {
        const takes = asked === "in_progress" || attachesThread;
        const refused = takes && typeof claimDecision({ status, takenBy }, me) === "object";
        expect(claimOnWrite({ status, takenBy }, request(asked, attachesThread, "thr_a"), me, NOW).ok).toBe(!refused);
      }),
    );
  });
});


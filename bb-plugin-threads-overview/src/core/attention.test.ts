import { describe, expect, it } from "vitest";
import {
  attentionQueue,
  edgeBleed,
  groupByProject,
  isWorking,
  nearestSlideIndex,
  needsAttention,
  sortQueue,
  type SortKey,
  type ThreadFacts,
} from "./attention";

const IDLE_ACTIVITY = {
  workflows: 0,
  backgroundAgents: 0,
  backgroundCommands: 0,
  planMode: 0,
  goals: 0,
};

function thread(over: Partial<ThreadFacts> = {}): ThreadFacts {
  return {
    id: "t1",
    projectId: "p1",
    isArchived: false,
    hasPendingInteraction: false,
    indicator: "none",
    activity: IDLE_ACTIVITY,
    latestAttentionAt: 1000,
    ...over,
  };
}

const none = new Set<string>();

describe("isWorking", () => {
  it("an idle thread with nothing running is not working", () => {
    expect(isWorking(thread())).toBe(false);
  });

  it("a running foreground turn is working", () => {
    expect(isWorking(thread({ indicator: "runtime" }))).toBe(true);
  });

  it.each([
    ["workflows", { ...IDLE_ACTIVITY, workflows: 1 }],
    ["background agent", { ...IDLE_ACTIVITY, backgroundAgents: 2 }],
    ["background command", { ...IDLE_ACTIVITY, backgroundCommands: 1 }],
    ["plan mode", { ...IDLE_ACTIVITY, planMode: 1 }],
    ["goals", { ...IDLE_ACTIVITY, goals: 3 }],
  ])("a positive %s count is working", (_label, activity) => {
    expect(isWorking(thread({ activity }))).toBe(true);
  });

  it("a thread waiting on the user is not working even while a turn runs", () => {
    expect(
      isWorking(thread({ hasPendingInteraction: true, indicator: "runtime" })),
    ).toBe(false);
  });

  it("a thread waiting on the user is not working even with background work", () => {
    expect(
      isWorking(
        thread({
          hasPendingInteraction: true,
          activity: { ...IDLE_ACTIVITY, backgroundAgents: 1 },
        }),
      ),
    ).toBe(false);
  });
});

describe("needsAttention", () => {
  it("an idle, unpostponed thread needs attention", () => {
    expect(needsAttention(thread(), none)).toBe(true);
  });

  it("a thread waiting on the user needs attention", () => {
    expect(
      needsAttention(thread({ hasPendingInteraction: true, indicator: "runtime" }), none),
    ).toBe(true);
  });

  it("a working thread does not need attention", () => {
    expect(needsAttention(thread({ indicator: "runtime" }), none)).toBe(false);
  });

  it("a postponed thread does not need attention", () => {
    expect(needsAttention(thread({ id: "x" }), new Set(["x"]))).toBe(false);
  });

  it("an archived thread never needs attention", () => {
    expect(needsAttention(thread({ isArchived: true }), none)).toBe(false);
  });
});

describe("sortQueue", () => {
  const a = thread({ id: "a", projectId: "beta", latestAttentionAt: 300 });
  const b = thread({ id: "b", projectId: "alpha", latestAttentionAt: 100 });
  const c = thread({ id: "c", projectId: "alpha", latestAttentionAt: 200 });

  it("waiting-longest puts the oldest queue entry first", () => {
    expect(sortQueue([a, b, c], "waiting-longest").map((t) => t.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("waiting-newest puts the freshest queue entry first", () => {
    expect(sortQueue([a, b, c], "waiting-newest").map((t) => t.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("breaks ties on equal timestamps by id, deterministically", () => {
    const x = thread({ id: "x", latestAttentionAt: 500 });
    const y = thread({ id: "y", latestAttentionAt: 500 });
    expect(sortQueue([y, x], "waiting-longest").map((t) => t.id)).toEqual([
      "x",
      "y",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [a, b, c];
    sortQueue(input, "waiting-newest");
    expect(input.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});

describe("attentionQueue", () => {
  it("filters out working, postponed and archived threads, then orders", () => {
    const idleOld = thread({ id: "idle-old", latestAttentionAt: 100 });
    const idleNew = thread({ id: "idle-new", latestAttentionAt: 400 });
    const working = thread({ id: "working", indicator: "runtime", latestAttentionAt: 200 });
    const postponed = thread({ id: "postponed", latestAttentionAt: 150 });
    const archived = thread({ id: "archived", isArchived: true, latestAttentionAt: 50 });

    const queue = attentionQueue(
      [idleNew, working, postponed, archived, idleOld],
      new Set(["postponed"]),
      "waiting-longest" satisfies SortKey,
    );

    expect(queue.map((t) => t.id)).toEqual(["idle-old", "idle-new"]);
  });
});

describe("groupByProject", () => {
  const a = thread({ id: "a", projectId: "p-beta", latestAttentionAt: 300 });
  const b = thread({ id: "b", projectId: "p-alpha", latestAttentionAt: 100 });
  const c = thread({ id: "c", projectId: "p-alpha", latestAttentionAt: 200 });
  const names: Record<string, string> = { "p-alpha": "Alpha", "p-beta": "Beta" };
  const nameOf = (id: string) => names[id] ?? id;

  it("puts every thread in the group of its project", () => {
    expect(
      groupByProject([a, b, c], nameOf).map((group) => [
        group.projectId,
        group.threads.map((t) => t.id),
      ]),
    ).toEqual([
      ["p-alpha", ["b", "c"]],
      ["p-beta", ["a"]],
    ]);
  });

  it("names each group with its project name", () => {
    expect(groupByProject([a, b], nameOf).map((group) => group.name)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  it("orders groups by project name, not by project id", () => {
    const zed = thread({ id: "z", projectId: "p-aaa" });
    const upper = (id: string) => (id === "p-aaa" ? "Zulu" : nameOf(id));
    expect(
      groupByProject([zed, a], upper).map((group) => group.projectId),
    ).toEqual(["p-beta", "p-aaa"]);
  });

  it("keeps the incoming thread order inside a group", () => {
    expect(
      groupByProject([c, b], nameOf)[0]!.threads.map((t) => t.id),
    ).toEqual(["c", "b"]);
  });

  it("has no groups for an empty queue", () => {
    expect(groupByProject([], nameOf)).toEqual([]);
  });
});

describe("nearestSlideIndex", () => {
  it("picks the slide whose centre is closest to the viewport centre", () => {
    expect(nearestSlideIndex([50, 150, 250], 140)).toBe(1);
  });

  it("picks the first slide at the start of the track", () => {
    expect(nearestSlideIndex([50, 150, 250], 0)).toBe(0);
  });

  it("picks the last slide past the end of the track", () => {
    expect(nearestSlideIndex([50, 150, 250], 9000)).toBe(2);
  });

  it("prefers the earlier slide when two are equally close", () => {
    expect(nearestSlideIndex([50, 150], 100)).toBe(0);
  });

  it("is 0 when there are no slides", () => {
    expect(nearestSlideIndex([], 100)).toBe(0);
  });
});

describe("edgeBleed", () => {
  it("reaches from each side of the section out to the same side of the clipping box", () => {
    expect(edgeBleed({ left: 300, right: 1060 }, { left: 100, right: 1400 })).toEqual({
      left: 200,
      right: 340,
    });
  });

  it("is zero on both sides when the section already fills the box", () => {
    expect(edgeBleed({ left: 0, right: 800 }, { left: 0, right: 800 })).toEqual({
      left: 0,
      right: 0,
    });
  });

  it("rounds down to whole pixels, so the track never overshoots the box by a fraction", () => {
    expect(edgeBleed({ left: 200.6, right: 960.4 }, { left: 0, right: 1161 })).toEqual({
      left: 200,
      right: 200,
    });
  });

  it("never goes negative when the section pokes past the box", () => {
    expect(edgeBleed({ left: 50, right: 900 }, { left: 100, right: 800 })).toEqual({
      left: 0,
      right: 0,
    });
  });
});

// Running threads in the queue: off by default, as the queue always was, and
// on request the working threads join the same list in the same order.
import { describe, expect, it } from "vitest";
import { attentionQueue, type ThreadFacts } from "./attention";

const IDLE = { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 };

function thread(id: string, over: Partial<ThreadFacts> = {}): ThreadFacts {
  return {
    id,
    projectId: "p1",
    isArchived: false,
    hasPendingInteraction: false,
    indicator: "none",
    activity: IDLE,
    latestAttentionAt: 1000,
    ...over,
  };
}

const waiting = thread("waiting", { latestAttentionAt: 3000 });
const foreground = thread("foreground", { indicator: "runtime", latestAttentionAt: 1000 });
const background = thread("background", { activity: { ...IDLE, goals: 1 }, latestAttentionAt: 2000 });
const ids = (queue: readonly ThreadFacts[]) => queue.map((t) => t.id);
const none = new Set<string>();

describe("attentionQueue and running threads", () => {
  it("leaves running threads out when not asked for them", () => {
    expect(ids(attentionQueue([waiting, foreground, background], none, "waiting-longest"))).toEqual([
      "waiting",
    ]);
  });

  it("leaves them out when asked explicitly not to show them", () => {
    expect(
      ids(attentionQueue([waiting, foreground, background], none, "waiting-longest", false)),
    ).toEqual(["waiting"]);
  });

  it("takes them into the one list, in the queue's own order, when asked", () => {
    expect(
      ids(attentionQueue([waiting, foreground, background], none, "waiting-longest", true)),
    ).toEqual(["foreground", "background", "waiting"]);
    expect(
      ids(attentionQueue([waiting, foreground, background], none, "waiting-newest", true)),
    ).toEqual(["waiting", "background", "foreground"]);
  });

  it("still keeps archived and postponed threads out, running or not", () => {
    const archived = thread("archived", { indicator: "runtime", isArchived: true });
    const postponed = thread("postponed", { indicator: "runtime" });
    const queue = attentionQueue(
      [waiting, archived, postponed],
      new Set(["postponed"]),
      "waiting-longest",
      true,
    );
    expect(ids(queue)).toEqual(["waiting"]);
  });
});

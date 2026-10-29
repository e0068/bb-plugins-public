// A message waiting in the host's queue (`queuedWork` "waiting") holds a
// Concurrency limit slot: the thread works, so it is out of the attention queue
// unless running threads are asked for. A failed one needs the user. The state
// is read from `queuedWork`, never from `indicator`, which the host fills with
// only the highest priority state — a dev server or an unread reply hides the
// queue there.
import { describe, expect, it } from "vitest";
import { attentionQueue, isWorking, needsAttention, type ThreadFacts } from "./attention";

const IDLE = { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 };

function thread(id: string, over: Partial<ThreadFacts> = {}): ThreadFacts {
  return {
    id,
    projectId: "p1",
    isArchived: false,
    hasPendingInteraction: false,
    indicator: "none",
    activity: IDLE,
    flowRun: null,
    latestAttentionAt: 1000,
    ...over,
  };
}

const none = new Set<string>();
const ids = (queue: readonly ThreadFacts[]) => queue.map((t) => t.id);
const waitingSend = thread("waiting-send", { queuedWork: "waiting", latestAttentionAt: 2000 });
const failed = thread("failed", { queuedWork: "failed", latestAttentionAt: 3000 });
const idle = thread("idle", { latestAttentionAt: 1000 });
const server = { ...IDLE, backgroundCommands: 1 };

describe("a thread with a message waiting to send", () => {
  it("is working", () => {
    expect(isWorking(waitingSend)).toBe(true);
  });

  it("does not need attention", () => {
    expect(needsAttention(waitingSend, none)).toBe(false);
  });

  it("is out of the queue by default and when running threads are not shown", () => {
    expect(ids(attentionQueue([idle, waitingSend], none, "waiting-longest"))).toEqual(["idle"]);
    expect(ids(attentionQueue([idle, waitingSend], none, "waiting-longest", false))).toEqual(["idle"]);
  });

  it("joins the queue, in its order, when running threads are shown", () => {
    expect(ids(attentionQueue([idle, waitingSend], none, "waiting-longest", true))).toEqual([
      "idle",
      "waiting-send",
    ]);
  });

  it.each([
    ["a dev server", { indicator: "background-command", activity: server }],
    ["an unread reply", { indicator: "unread-success" }],
    ["an unread error", { indicator: "unread-error" }],
  ] as const)("is still out of the queue with %s behind the host's indicator", (_name, over) => {
    const hidden = thread("hidden", { queuedWork: "waiting", ...over });
    expect(isWorking(hidden)).toBe(true);
    expect(ids(attentionQueue([idle, hidden], none, "waiting-longest"))).toEqual(["idle"]);
    expect(ids(attentionQueue([idle, hidden], none, "waiting-longest", true))).toEqual(["hidden", "idle"]);
  });

  it("is not working when it waits on the user's answer, and so needs attention", () => {
    const asking = thread("asking", { queuedWork: "waiting", hasPendingInteraction: true });
    expect(isWorking(asking)).toBe(false);
    expect(needsAttention(asking, none)).toBe(true);
  });

  it("stays out of the queue when archived or postponed, shown or not", () => {
    const archived = thread("archived", { queuedWork: "waiting", isArchived: true });
    const postponed = thread("postponed", { queuedWork: "waiting" });
    expect(ids(attentionQueue([archived, postponed], new Set(["postponed"]), "waiting-longest", true))).toEqual([]);
  });

  it("is not told from the host's own queued-waiting indicator: only queuedWork says so", () => {
    expect(isWorking(thread("indicated", { indicator: "queued-waiting" }))).toBe(false);
  });
});

describe("a thread whose queued message failed to send", () => {
  it("is not working", () => {
    expect(isWorking(failed)).toBe(false);
  });

  it("needs attention and is in the queue without asking for running threads", () => {
    expect(needsAttention(failed, none)).toBe(true);
    expect(ids(attentionQueue([idle, failed, waitingSend], none, "waiting-newest"))).toEqual([
      "failed",
      "idle",
    ]);
  });

  it("is in the queue with a dev server running", () => {
    const withServer = thread("failed-server", { queuedWork: "failed", indicator: "background-command", activity: server });
    expect(ids(attentionQueue([withServer], none, "waiting-longest"))).toEqual(["failed-server"]);
  });
});

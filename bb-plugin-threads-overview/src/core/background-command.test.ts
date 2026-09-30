// A thread whose agent finished while a background command — a dev server, a
// watcher — keeps running is waiting for the user, not working: it stands in
// the queue and its row says a process is up instead of spinning.
import { describe, expect, it } from "vitest";
import {
  attentionQueue,
  isWorking,
  needsAttention,
  runsBackgroundCommand,
  type ThreadFacts,
} from "./attention";
import { rowStatus } from "./status";

const IDLE = { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 };

function thread(id: string, over: Partial<ThreadFacts> = {}): ThreadFacts {
  return {
    id,
    projectId: "p1",
    isArchived: false,
    hasPendingInteraction: false,
    indicator: "background-command",
    activity: { ...IDLE, backgroundCommands: 1 },
    latestAttentionAt: 1000,
    ...over,
  };
}

const server = thread("server");
const none = new Set<string>();

describe("a thread with only a background command", () => {
  it("is not working", () => {
    expect(isWorking(server)).toBe(false);
  });

  it("runs a background command", () => {
    expect(runsBackgroundCommand(server)).toBe(true);
    expect(runsBackgroundCommand(thread("idle", { activity: IDLE, indicator: "none" }))).toBe(false);
  });

  it("needs attention and stands in the queue with running threads hidden", () => {
    expect(needsAttention(server, none)).toBe(true);
    expect(attentionQueue([server], none, "waiting-longest").map((t) => t.id)).toEqual(["server"]);
  });

  it.each([
    ["a foreground turn", { indicator: "runtime" }],
    ["a background agent", { activity: { ...IDLE, backgroundCommands: 1, backgroundAgents: 1 } }],
    ["a workflow", { activity: { ...IDLE, backgroundCommands: 1, workflows: 1 } }],
    ["a goal", { activity: { ...IDLE, backgroundCommands: 1, goals: 1 } }],
    ["plan mode", { activity: { ...IDLE, backgroundCommands: 1, planMode: 1 } }],
  ])("is working again once %s runs beside the command", (_label, over) => {
    expect(isWorking(thread("busy", over as Partial<ThreadFacts>))).toBe(true);
  });
});

describe("rowStatus of a thread with a background command", () => {
  const facts = { indicator: "background-command", hasPendingInteraction: false, working: false };

  it("shows the background command when nothing else is on the row", () => {
    expect(rowStatus({ ...facts, backgroundCommand: true })).toBe("background-command");
  });

  it("shows nothing for the command once it has stopped", () => {
    expect(rowStatus({ ...facts, indicator: "none", backgroundCommand: false })).toBeNull();
  });

  it("puts work, a pending question and an unread result above the command", () => {
    expect(rowStatus({ ...facts, working: true, backgroundCommand: true })).toBe("working");
    expect(rowStatus({ ...facts, hasPendingInteraction: true, backgroundCommand: true })).toBe(
      "waiting-for-input",
    );
    expect(rowStatus({ ...facts, indicator: "unread-success", backgroundCommand: true })).toBe(
      "unread-success",
    );
    expect(rowStatus({ ...facts, indicator: "unread-error", backgroundCommand: true })).toBe(
      "unread-error",
    );
  });
});

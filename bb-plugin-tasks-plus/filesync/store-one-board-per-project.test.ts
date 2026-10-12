// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createFileTasksStore } from "./store.js";
import type { BoardConfig, KvStore } from "./board-config.js";

function fakeKv(): KvStore {
  const map = new Map<string, unknown>();
  return {
    get: async (key) => map.get(key) as never,
    set: async (key, value) => void map.set(key, structuredClone(value)),
  };
}

const board = (id: string, prefix: string, linkedBbProjectId: string | null): BoardConfig => ({
  id,
  name: `Board ${prefix}`,
  prefix,
  color: "blue",
  folderId: null,
  linkedBbProjectId,
  tasksFolder: null,
  database: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const TAKEN = board("01M0T4QGCQ3BYK15NH50AD38RV", "ONE", "proj_one");
const FREE = board("01M0T4QGCQ3BYK15NH50AD38RW", "TWO", null);
/** Written before the rule: a second board on the same bb project. */
const DUPLICATE = board("01M0T4QGCQ3BYK15NH50AD38RX", "DUP", "proj_one");

const storeWith = (boards: BoardConfig[]) => createFileTasksStore(fakeKv(), boards, [], [], [], () => {});

describe("one board per bb project", () => {
  it("refuses a new board on a bb project another board took, naming that board", () => {
    const store = storeWith([TAKEN]);
    expect(() => store.createProject({ name: "Second", prefix: "SEC", color: "red", linkedBbProjectId: "proj_one" })).toThrow(
      "bb project proj_one is already linked to board ONE (Board ONE)",
    );
    expect(store.listProjects()).toHaveLength(1);
  });

  it("refuses linking a board to a bb project another board took", () => {
    const store = storeWith([TAKEN, FREE]);
    expect(() => store.updateProject(FREE.id, { linkedBbProjectId: "proj_one" })).toThrow(/already linked to board ONE/);
    expect(store.getProject(FREE.id)?.linkedBbProjectId).toBeNull();
  });

  it("lets a board on a free bb project, and an unlinked board, be created", () => {
    const store = storeWith([TAKEN]);
    expect(store.createProject({ name: "Free", prefix: "FRE", color: "red", linkedBbProjectId: "proj_free" }).linkedBbProjectId).toBe("proj_free");
    expect(store.createProject({ name: "Loose", prefix: "LOO", color: "red" }).linkedBbProjectId).toBeNull();
  });

  it("lets a board already written as a duplicate be edited and unlinked", () => {
    const store = storeWith([TAKEN, DUPLICATE]);
    expect(store.updateProject(DUPLICATE.id, { color: "green" }).color).toBe("green");
    expect(store.updateProject(DUPLICATE.id, { linkedBbProjectId: null }).linkedBbProjectId).toBeNull();
  });

  it("keeps the icon a board is given", () => {
    const store = storeWith([FREE]);
    expect(store.updateProject(FREE.id, { icon: "Rocket" }).icon).toBe("Rocket");
    expect(store.getProject(FREE.id)?.icon).toBe("Rocket");
  });
});

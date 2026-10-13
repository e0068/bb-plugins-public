import { describe, expect, it } from "vitest";
import { readBoardConfigs, type KvStore } from "./board-config.js";

const folderBoard = {
  id: "b1",
  name: "Board",
  prefix: "TSK",
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: "docs/tasks",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function kvWith(boards: unknown[]): KvStore {
  const stored = new Map<string, unknown>([["boards", boards]]);
  return { get: async (key) => stored.get(key) as never, set: async (key, value) => void stored.set(key, value) };
}

describe("a board record from before databases", () => {
  it("reads as a folder board", async () => {
    const [board] = await readBoardConfigs(kvWith([folderBoard]));
    expect(board?.database).toBeNull();
  });

  it("keeps the address of a database board", async () => {
    const [board] = await readBoardConfigs(kvWith([{ ...folderBoard, tasksFolder: null, database: { url: "libsql://board-me.turso.io" } }]));
    expect(board?.database).toEqual({ url: "libsql://board-me.turso.io" });
  });
});

describe("a section's board record", () => {
  const section = (database: Record<string, unknown>) => ({ ...folderBoard, tasksFolder: null, database: { url: "libsql://board-me.turso.io", ...database } });

  it("keeps the section it sits in", async () => {
    const [board] = await readBoardConfigs(kvWith([section({ table: "specs001", parent: "docs0001" })]));
    expect(board?.database).toEqual({ url: "libsql://board-me.turso.io", table: "specs001", parent: "docs0001" });
  });

  it("reads a parent that is not a section id as no parent — a top section", async () => {
    const [board] = await readBoardConfigs(kvWith([section({ table: "specs001", parent: "x; DROP" })]));
    expect(board?.database).toEqual({ url: "libsql://board-me.turso.io", table: "specs001" });
  });
});

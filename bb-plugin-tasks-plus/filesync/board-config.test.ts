import { describe, it, expect } from "vitest";
import {
  readBoardConfigs,
  writeBoardConfigs,
  upsertBoardConfig,
  removeBoardConfig,
  findBoardBySource,
  nextTaskNumber,
  type BoardConfig,
  type KvStore,
} from "./board-config.js";

function fakeKv(initial: Record<string, unknown> = {}): KvStore {
  const store = new Map(Object.entries(initial));
  return {
    async get(key) {
      return store.get(key) as never;
    },
    async set(key, value) {
      store.set(key, value);
    },
  };
}

function board(overrides: Partial<BoardConfig>): BoardConfig {
  return {
    id: "b1",
    name: "Board",
    prefix: "TSK",
    color: "blue",
    folderId: null,
    linkedBbProjectId: "proj1",
    tasksFolder: "memory/tasks",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("readBoardConfigs / writeBoardConfigs", () => {
  it("возвращает пустой список, когда ключа ещё нет", async () => {
    expect(await readBoardConfigs(fakeKv())).toEqual([]);
  });

  it("читает то, что было записано", async () => {
    const kv = fakeKv();
    await writeBoardConfigs(kv, [board({})]);
    expect(await readBoardConfigs(kv)).toEqual([board({})]);
  });
});

describe("upsertBoardConfig", () => {
  it("добавляет новую доску", () => {
    const result = upsertBoardConfig([], board({ id: "a" }));
    expect(result).toHaveLength(1);
  });

  it("заменяет доску с тем же id", () => {
    const boards = [board({ id: "a", name: "Old" })];
    const result = upsertBoardConfig(boards, board({ id: "a", name: "New" }));
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("New");
  });
});

describe("removeBoardConfig", () => {
  it("убирает доску по id, не трогая остальные", () => {
    const boards = [board({ id: "a" }), board({ id: "b" })];
    expect(removeBoardConfig(boards, "a").map((b) => b.id)).toEqual(["b"]);
  });
});

describe("findBoardBySource", () => {
  it("находит доску по bb-проекту и пути папки", () => {
    const boards = [
      board({ id: "a", linkedBbProjectId: "p1", tasksFolder: "memory/tasks" }),
      board({ id: "b", linkedBbProjectId: "p2", tasksFolder: "tasks" }),
    ];
    expect(findBoardBySource(boards, "p2", "tasks")?.id).toBe("b");
    expect(findBoardBySource(boards, "p1", "other")).toBeUndefined();
  });
});

describe("nextTaskNumber", () => {
  it("единица, когда ключей ещё нет", () => {
    expect(nextTaskNumber([], "TSK")).toBe(1);
  });

  it("максимум плюс один, без учёта регистра префикса", () => {
    expect(nextTaskNumber(["tsk-3", "TSK-7", "TSK-1"], "TSK")).toBe(8);
  });

  it("игнорирует ключи чужого префикса", () => {
    expect(nextTaskNumber(["OTHER-99", "TSK-2"], "TSK")).toBe(3);
  });
});

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileTasksStore } from "./store.js";
import type { BoardConfig, KvStore } from "./board-config.js";

let root: string;
let store: ReturnType<typeof createFileTasksStore>;

function fakeKv(): KvStore {
  const map = new Map<string, unknown>();
  return {
    async get(key) {
      return map.get(key) as never;
    },
    async set(key, value) {
      map.set(key, value);
    },
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "store-flow-"));
  const board: BoardConfig = { id: "b1", name: "Board", prefix: "TSK", color: "blue", folderId: null, linkedBbProjectId: null, tasksFolder: "tasks", database: null, createdAt: "2026-01-01T00:00:00.000Z" };
  store = createFileTasksStore(fakeKv(), [board], [], [], [], () => {});
  store.setBoardRoots("b1", [{ absPath: root, origin: { kind: "main" } }]);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function writeTaskFile(slug: string, frontmatter: string): string {
  mkdirSync(join(root, "todo"), { recursive: true });
  const filePath = join(root, "todo", `${slug}.md`);
  writeFileSync(filePath, `---\n${frontmatter}\n---\n\nBody.\n`);
  return filePath;
}

describe("flow задачи из файла", () => {
  it("задача с блоком flow в шапке отдаётся с flow", async () => {
    writeTaskFile("flowed", 'title: Flowed\nflow:\n  id: flow-code\n  name: "Code"');
    expect((await store.getTaskByKey("flowed"))?.flow).toEqual({ id: "flow-code", name: "Code" });
  });

  it("задача без блока flow отдаётся без flow", async () => {
    writeTaskFile("plain", "title: Plain");
    expect((await store.getTaskByKey("plain"))?.flow ?? null).toBeNull();
  });

  it("правка задачи не стирает ни блок flow, ни старую строку checks", async () => {
    const filePath = writeTaskFile("legacy", 'title: Legacy\nchecks:\n  - test\n  - review\nflow:\n  id: flow-code\n  name: "Code"');
    await store.updateTask("b1:legacy", { title: "Legacy renamed", estimate: "s" });
    const text = readFileSync(filePath, "utf8");
    expect(text).toContain("title: Legacy renamed");
    expect(text).toMatch(/checks:\n\s+- test\n\s+- review/);
    expect(text).toMatch(/flow:\n\s+id: flow-code\n\s+name: Code/);
    expect((await store.getTaskByKey("legacy"))?.flow).toEqual({ id: "flow-code", name: "Code" });
  });
});

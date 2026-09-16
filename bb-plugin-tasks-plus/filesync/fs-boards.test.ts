import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { onePerSlug, readBoardTaskFiles, type BoardRoot } from "./fs-boards.js";

let mainRoot: string;
let worktreeRoot: string;
beforeEach(() => {
  mainRoot = mkdtempSync(join(tmpdir(), "board-main-"));
  worktreeRoot = mkdtempSync(join(tmpdir(), "board-wt-"));
});
afterEach(() => {
  rmSync(mainRoot, { recursive: true, force: true });
  rmSync(worktreeRoot, { recursive: true, force: true });
});

function writeTask(root: string, slug: string, title: string) {
  mkdirSync(join(root, "todo"), { recursive: true });
  writeFileSync(join(root, "todo", `${slug}.md`), `---\ntitle: ${title}\nslug: ${slug}\n---\n\nBody.\n`);
}

const WORKTREE_ORIGIN = { kind: "worktree" as const, environmentId: "env_x", name: null, branchName: null };

describe("readBoardTaskFiles", () => {
  it("читает только main, когда других корней нет", async () => {
    writeTask(mainRoot, "my-task", "Main");
    const roots: BoardRoot[] = [{ absPath: mainRoot, origin: { kind: "main" } }];

    const result = await readBoardTaskFiles(roots);
    expect(result).toHaveLength(1);
    expect(result[0]?.origin).toEqual({ kind: "main" });
  });

  it("схлопывает копию worktree, идентичную main", async () => {
    writeTask(mainRoot, "my-task", "Same");
    writeTask(worktreeRoot, "my-task", "Same");
    const roots: BoardRoot[] = [
      { absPath: mainRoot, origin: { kind: "main" } },
      { absPath: worktreeRoot, origin: WORKTREE_ORIGIN },
    ];

    const result = await readBoardTaskFiles(roots);
    expect(result).toHaveLength(1);
    expect(result[0]?.origin).toEqual({ kind: "main" });
  });

  it("показывает отличающуюся копию worktree отдельной строкой", async () => {
    writeTask(mainRoot, "my-task", "Main version");
    writeTask(worktreeRoot, "my-task", "Worktree version");
    const roots: BoardRoot[] = [
      { absPath: mainRoot, origin: { kind: "main" } },
      { absPath: worktreeRoot, origin: WORKTREE_ORIGIN },
    ];

    const result = await readBoardTaskFiles(roots);
    expect(result).toHaveLength(2);
    const wt = result.find((f) => f.origin.kind === "worktree");
    expect(wt?.task.title).toBe("Worktree version");
  });

  it("включает задачу, существующую только в worktree", async () => {
    writeTask(worktreeRoot, "my-task", "Only worktree");
    const roots: BoardRoot[] = [
      { absPath: mainRoot, origin: { kind: "main" } },
      { absPath: worktreeRoot, origin: WORKTREE_ORIGIN },
    ];

    const result = await readBoardTaskFiles(roots);
    expect(result).toHaveLength(1);
    expect(result[0]?.origin.kind).toBe("worktree");
  });
});

// Обычному запросу нужна ровно одна копия слага: две дают две задачи с одним
// id — список двоится, а правка уходит не в тот файл. Витрине копий (BP-187)
// нужны обе, поэтому отбор живёт отдельно от чтения.
describe("onePerSlug", () => {
  it("оставляет копию первого корня и выбрасывает расходящуюся копию ветки", async () => {
    writeTask(mainRoot, "my-task", "Main version");
    writeTask(worktreeRoot, "my-task", "Worktree version");
    const roots: BoardRoot[] = [
      { absPath: mainRoot, origin: { kind: "main" } },
      { absPath: worktreeRoot, origin: WORKTREE_ORIGIN },
    ];

    const result = onePerSlug(await readBoardTaskFiles(roots));
    expect(result).toHaveLength(1);
    expect(result[0]?.task.title).toBe("Main version");
    expect(result[0]?.origin).toEqual({ kind: "main" });
  });

  it("не трогает слаги, которые есть только в одном дереве", async () => {
    writeTask(mainRoot, "from-main", "Main");
    writeTask(worktreeRoot, "from-branch", "Branch");
    const roots: BoardRoot[] = [
      { absPath: mainRoot, origin: { kind: "main" } },
      { absPath: worktreeRoot, origin: WORKTREE_ORIGIN },
    ];

    const result = onePerSlug(await readBoardTaskFiles(roots));
    expect(result.map((file) => file.slug).sort()).toEqual(["from-branch", "from-main"]);
  });
});

describe("readBoardTaskFiles: исполнитель и эпик", () => {
  it("копия в ветке, перенесённая к исполнителю без правки текста, не схлопывается в main", async () => {
    writeTask(mainRoot, "my-task", "Same");
    mkdirSync(join(worktreeRoot, "Alice", "todo"), { recursive: true });
    writeFileSync(join(worktreeRoot, "Alice", "todo", "my-task.md"), "---\ntitle: Same\nslug: my-task\n---\n\nBody.\n");

    const result = await readBoardTaskFiles([
      { absPath: mainRoot, origin: { kind: "main" } },
      { absPath: worktreeRoot, origin: WORKTREE_ORIGIN },
    ]);

    expect(result.map((f) => f.assignee)).toEqual([null, "Alice"]);
  });
});

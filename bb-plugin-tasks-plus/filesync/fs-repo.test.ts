import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTaskFiles, rootOfTaskFile, writeTaskFile } from "./fs-repo.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tasks-fs-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const TASK = "---\ntitle: My Task\nslug: my-task\n---\n\nBody.\n";

describe("readTaskFiles", () => {
  it("читает задачи из статусных папок, пропуская не .md и мусор", async () => {
    mkdirSync(join(root, "todo"), { recursive: true });
    writeFileSync(join(root, "todo", "my-task.md"), TASK);
    writeFileSync(join(root, "todo", "README.txt"), "мусор");
    mkdirSync(join(root, "not-a-status"), { recursive: true });
    writeFileSync(join(root, "not-a-status", "x.md"), TASK);

    const result = await readTaskFiles(root);
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("todo");
    expect(result[0]?.slug).toBe("my-task");
  });

  it("файл со сломанным frontmatter читается: поля пустые, имя файла на месте", async () => {
    mkdirSync(join(root, "todo"), { recursive: true });
    writeFileSync(join(root, "todo", "good.md"), TASK);
    writeFileSync(join(root, "todo", "bad.md"), "---\n[не мэппинг]\n---\nтело");

    const result = await readTaskFiles(root);

    expect(result).toHaveLength(2);
    const bad = result.find((f) => f.slug === "bad");
    expect(bad?.status).toBe("todo");
    expect(bad?.frontmatter).toEqual({});
  });

  it("возвращает пусто для несуществующего корня", async () => {
    expect(await readTaskFiles(join(root, "nope"))).toEqual([]);
  });
});

describe("writeTaskFile", () => {
  it("пишет новый файл, создавая статусную папку", async () => {
    const path = await writeTaskFile(root, "todo", "my-task", "content");
    expect(path).toBe(join(root, "todo", "my-task.md"));
    expect(readFileSync(path, "utf8")).toBe("content");
  });

  it("переносит файл при смене статуса", async () => {
    const first = await writeTaskFile(root, "todo", "my-task", TASK);
    const second = await writeTaskFile(root, "done", "my-task", TASK, first);

    const result = await readTaskFiles(root);
    expect(result).toHaveLength(1);
    expect(result[0]?.filePath).toBe(second);
    expect(result[0]?.status).toBe("done");
  });
});

describe("исполнитель и эпик — папки над статусом", () => {
  function put(...segments: string[]) {
    mkdirSync(join(root, ...segments.slice(0, -1)), { recursive: true });
    writeFileSync(join(root, ...segments), TASK);
  }

  it("читает задачи корня, папки исполнителя и папки эпика внутри неё", async () => {
    put("todo", "plain.md");
    put("Claude", "done", "solo.md");
    put("Claude", "Tasks+", "In progress", "deep.md");

    const bySlug = new Map((await readTaskFiles(root)).map((f) => [f.slug, f]));

    expect(bySlug.get("plain")).toMatchObject({ status: "todo", assignee: null, epic: null });
    expect(bySlug.get("solo")).toMatchObject({ status: "done", assignee: "Claude", epic: null });
    expect(bySlug.get("deep")).toMatchObject({ status: "in_progress", assignee: "Claude", epic: "Tasks+" });
  });

  it("глубже эпика и в скрытых папках задач не ищет", async () => {
    put("Claude", "Tasks+", "Extra", "todo", "too-deep.md");
    put(".git", "todo", "hidden.md");
    put("Claude", ".cache", "todo", "hidden-epic.md");

    expect(await readTaskFiles(root)).toEqual([]);
  });

  it("смена исполнителя и эпика переносит файл, корень вычисляется обратно", async () => {
    const first = await writeTaskFile(root, "todo", "my-task", TASK);
    const second = await writeTaskFile(root, "todo", "my-task", TASK, first, { assignee: "Claude", epic: "Tasks+" });

    expect(second).toBe(join(root, "Claude", "Tasks+", "todo", "my-task.md"));
    expect(rootOfTaskFile(second, { assignee: "Claude", epic: "Tasks+" })).toBe(root);
    const result = await readTaskFiles(root);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ assignee: "Claude", epic: "Tasks+", status: "todo" });
  });

  it("пишет в уже существующую папку статуса с другим написанием", async () => {
    put("Claude", "In progress", "other.md");

    const path = await writeTaskFile(root, "in_progress", "my-task", TASK, undefined, { assignee: "Claude", epic: null });

    expect(path).toBe(join(root, "Claude", "In progress", "my-task.md"));
  });
});

describe("writeTaskFile: соседние папки и чужие файлы", () => {
  it("правка на месте не уводит файл в соседнюю папку того же статуса", async () => {
    mkdirSync(join(root, "in_progress"), { recursive: true });
    mkdirSync(join(root, "In progress"), { recursive: true });
    const current = join(root, "In progress", "my-task.md");
    writeFileSync(current, TASK);
    const other = join(root, "in_progress", "my-task-2.md");
    writeFileSync(other, TASK);

    expect(await writeTaskFile(root, "in_progress", "my-task", TASK, current)).toBe(current);
    expect(await writeTaskFile(root, "in_progress", "my-task-2", TASK, other)).toBe(other);
  });

  it("перенос на место, где уже лежит файл, отвергается и ничего не затирает", async () => {
    mkdirSync(join(root, "todo"), { recursive: true });
    mkdirSync(join(root, "Bob", "todo"), { recursive: true });
    writeFileSync(join(root, "todo", "x.md"), "visible");
    writeFileSync(join(root, "Bob", "todo", "x.md"), "hidden");

    await expect(
      writeTaskFile(root, "todo", "x", "new", join(root, "todo", "x.md"), { assignee: "Bob", epic: null }),
    ).rejects.toThrow(/already/);
    expect(readFileSync(join(root, "Bob", "todo", "x.md"), "utf8")).toBe("hidden");
    expect(readFileSync(join(root, "todo", "x.md"), "utf8")).toBe("visible");
  });
});

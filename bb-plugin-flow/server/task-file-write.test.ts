// @vitest-environment node
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { writeTaskFile } from "./task-file";

const tree = async () => {
  const root = await mkdtemp(join(tmpdir(), "flow-task-file-write-"));
  await mkdir(join(root, "docs/tasks/todo"), { recursive: true });
  return root;
};

const sdk = (environmentId: string | null, path: string | null) => ({
  threads: { get: async ({ threadId }: { threadId: string }) => ({ id: threadId, environmentId }) },
  environments: { get: async ({ environmentId: id }: { environmentId: string }) => ({ id, path }) },
});

describe("запись файла задачи в дерево треда", () => {
  it("относительный путь пишется от корня дерева треда", async () => {
    const root = await tree();
    await writeTaskFile(sdk("env_1", root), "thr_1", "docs/tasks/todo/a.md", "---\ntitle: А\n---\n");
    expect(await readFile(join(root, "docs/tasks/todo/a.md"), "utf8")).toBe("---\ntitle: А\n---\n");
  });

  it("абсолютный путь пишется как есть, без окружения треда", async () => {
    const root = await tree();
    const target = join(root, "docs/tasks/todo/b.md");
    await writeTaskFile(sdk(null, null), "thr_1", target, "Б");
    expect(await readFile(target, "utf8")).toBe("Б");
  });

  it("относительный путь у треда без дерева — отказ, а не запись в чужой каталог", async () => {
    await expect(writeTaskFile(sdk(null, null), "thr_1", "docs/tasks/todo/a.md", "А")).rejects.toThrow(/no worktree/);
  });
});

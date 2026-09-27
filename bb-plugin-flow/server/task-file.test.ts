// @vitest-environment node
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readTaskFile } from "./task-file";

/** Дерево треда во временном каталоге с одним файлом задачи. */
const tree = async () => {
  const root = await mkdtemp(join(tmpdir(), "flow-task-file-"));
  await mkdir(join(root, "docs/tasks/todo"), { recursive: true });
  await writeFile(join(root, "docs/tasks/todo/a.md"), "---\ntitle: А\n---\n");
  return root;
};

const sdk = (environmentId: string | null, path: string | null) => ({
  threads: { get: async ({ threadId }: { threadId: string }) => ({ id: threadId, environmentId }) },
  environments: { get: async ({ environmentId: id }: { environmentId: string }) => ({ id, path }) },
});

describe("файл задачи из дерева треда", () => {
  it("относительный путь читается от корня дерева треда", async () => {
    const root = await tree();
    expect(await readTaskFile(sdk("env_1", root), "thr_1", "docs/tasks/todo/a.md")).toBe("---\ntitle: А\n---\n");
  });

  it("абсолютный путь читается как есть, без окружения треда", async () => {
    const root = await tree();
    expect(await readTaskFile(sdk(null, null), "thr_1", join(root, "docs/tasks/todo/a.md"))).toBe("---\ntitle: А\n---\n");
  });

  it("относительный путь у треда без дерева — отказ, а не чтение от чужого каталога", async () => {
    await expect(readTaskFile(sdk(null, null), "thr_1", "docs/tasks/todo/a.md")).rejects.toThrow(/no worktree/);
    await expect(readTaskFile(sdk("env_1", null), "thr_1", "docs/tasks/todo/a.md")).rejects.toThrow(/no worktree/);
  });
});

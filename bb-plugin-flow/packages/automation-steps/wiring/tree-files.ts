// Слой 3 (оболочка) — запись и удаление файлов рабочего дерева: сведённые
// конфликты пишутся в дерево до `git add`. Вторая точка эффекта рядом с
// git-client.ts; логики здесь нет.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Файлы рабочего дерева по путям от его корня. */
export interface TreeFiles {
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export function treeFiles(root: string): TreeFiles {
  return {
    async write(path, text) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    },
    async remove(path) {
      await rm(join(root, path), { force: true });
    },
  };
}

import type { FileTaskOrigin } from "../db/types.js";
import { readTaskFiles, type RepoTaskFile } from "./fs-repo.js";
import { sha256 } from "./validators.js";

export interface BoardRoot {
  absPath: string;
  origin: FileTaskOrigin;
}

export interface BoardTaskFile extends RepoTaskFile {
  origin: FileTaskOrigin;
}

function contentSha(file: RepoTaskFile): string {
  // The folders are part of the task: a branch that only moved the file to
  // another assignee or epic holds a different task with the same text.
  return sha256(JSON.stringify({ task: file.task, comments: file.comments, assignee: file.assignee, epic: file.epic }));
}

/**
 * Reads every given root and lists worktree copies alongside main's, never
 * merged — a worktree's copy of a slug appears only when it differs from
 * main's (or main has none); an identical copy collapses into main's single
 * row. `roots` order matters: the first root carrying a slug is treated as
 * that slug's "main" for comparison purposes — roots are read concurrently,
 * but merged in the given order to keep that meaning.
 */
export async function readBoardTaskFiles(
  roots: readonly BoardRoot[],
): Promise<BoardTaskFile[]> {
  const perRoot = await Promise.all(roots.map((root) => readTaskFiles(root.absPath)));

  const files: BoardTaskFile[] = [];
  const seenBySlug = new Map<string, RepoTaskFile>();

  roots.forEach(({ origin }, index) => {
    for (const file of perRoot[index] ?? []) {
      const seen = seenBySlug.get(file.slug);
      if (seen && contentSha(seen) === contentSha(file)) continue;
      if (!seen) seenBySlug.set(file.slug, file);
      files.push({ ...file, origin });
    }
  });
  return files;
}

/**
 * Одна копия на слаг — та, что пришла из первого корня (main). Две копии
 * одного слага дают две задачи с одним id (`filesync/assemble.ts`): список
 * двоится, а правка находит первую попавшуюся и может уйти не в тот файл.
 * Поэтому запрос смотрит на задачу одним взглядом: файл из main, если он
 * там есть, иначе файл своего дерева. Витрине копий из веток (BP-187) нужны
 * обе строки — она читает `readBoardTaskFiles` без этого отбора.
 */
export function onePerSlug(files: readonly BoardTaskFile[]): BoardTaskFile[] {
  const bySlug = new Map<string, BoardTaskFile>();
  for (const file of files) {
    if (!bySlug.has(file.slug)) bySlug.set(file.slug, file);
  }
  return [...bySlug.values()];
}

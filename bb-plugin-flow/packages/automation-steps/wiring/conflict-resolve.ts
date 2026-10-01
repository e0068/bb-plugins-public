// Слой 3 (оболочка) — сведение конфликтов, которые шаг догоняния не отдаёт
// агенту: файлов задач и пунктов ченж-лога. Копии сторон читаются из стадий
// индекса, правило сведения — core/conflict-merge.ts, сведённое пишется в
// дерево и в индекс. Коммит слияния и отмену решает wiring/catch-up.ts.
import { addPathsArgs, showAtArgs, showStageArgs, taskCopiesArgs, trackedPathArgs, unstagePathsArgs } from "../core/catch-up";
import { mergeChangelog, mergeTaskFile, taskFolder, taskPathParts, type Unmerged } from "../core/conflict-merge";
import { gitRunMessage, type GitPorts } from "./git-run";
import type { TreeFiles } from "./tree-files";

const show = async (ports: GitPorts, args: readonly string[]): Promise<string | null> => {
  const shown = await ports.run(args);
  return shown.code === 0 ? shown.stdout : null;
};

const must = async (ports: GitPorts, args: readonly string[]): Promise<void> => {
  const result = await ports.run(args);
  if (result.code !== 0) throw new Error(`git ${args.join(" ")}: ${gitRunMessage(result)}`);
};

/** Итоговый путь и текст: старые пути снимаются из дерева и индекса, итоговый пишется и добавляется. */
const settle = async (ports: GitPorts, files: TreeFiles, target: string, text: string, dropped: readonly string[]): Promise<void> => {
  const gone = dropped.filter((path) => path !== target);
  for (const path of gone) await files.remove(path);
  if (gone.length > 0) await must(ports, unstagePathsArgs(gone));
  await files.write(target, text);
  await must(ports, addPathsArgs([target]));
};

/** Другая копия той же задачи по слагу: перенос в другую папку, который git не узнал. */
const otherCopy = async (ports: GitPorts, path: string, slug: string): Promise<string | null> => {
  const listed = (await show(ports, taskCopiesArgs(slug))) ?? "";
  return [...new Set(listed.split("\n").map((line) => line.trim()))].find((line) => line !== "" && line !== path) ?? null;
};

/**
 * Одна сторона перенесла задачу в другую папку, другая правила её на старом месте: git видит удаление против правки.
 * `kept` — стадия правившей стороны, `movedAt` — коммит перенёсшей; `moverIsOurs` — перенесла ветка (иначе main).
 * Перенёсшая сторона задачу удалила, а не перенесла — файлы задач не удаляют, остаётся правка.
 */
const resolveMoved = async (
  ports: GitPorts,
  files: TreeFiles,
  path: string,
  parts: { folder: string; slug: string },
  side: { kept: 2 | 3; movedAt: "HEAD" | "MERGE_HEAD"; moverIsOurs: boolean },
): Promise<boolean> => {
  const edited = await show(ports, showStageArgs(side.kept, path));
  if (edited === null) return false;
  const moved = await otherCopy(ports, path, parts.slug);
  const relocated = moved === null ? null : await show(ports, showAtArgs(side.movedAt, moved));
  if (moved === null || relocated === null) {
    await settle(ports, files, path, edited, []);
    return true;
  }
  const movedFolder = taskPathParts(moved)!.folder;
  const [ours, theirs] = side.moverIsOurs ? [relocated, edited] : [edited, relocated];
  const folder = side.moverIsOurs ? taskFolder({ oursFolder: movedFolder, theirsFolder: parts.folder }) : taskFolder({ oursFolder: parts.folder, theirsFolder: movedFolder });
  await settle(ports, files, `docs/tasks/${folder}/${parts.slug}.md`, mergeTaskFile({ ours, theirs }), [path, moved]);
  return true;
};

const resolveTask = async (ports: GitPorts, files: TreeFiles, { path, kind }: Unmerged): Promise<boolean> => {
  const parts = taskPathParts(path);
  if (parts === null) return false;
  if (kind === "both-modified" || kind === "both-added") {
    const [ours, theirs] = [await show(ports, showStageArgs(2, path)), await show(ports, showStageArgs(3, path))];
    if (ours === null || theirs === null) return false;
    await settle(ports, files, path, mergeTaskFile({ ours, theirs }), []);
    return true;
  }
  if (kind === "deleted-by-us") return resolveMoved(ports, files, path, parts, { kept: 3, movedAt: "HEAD", moverIsOurs: true });
  if (kind === "deleted-by-them") return resolveMoved(ports, files, path, parts, { kept: 2, movedAt: "MERGE_HEAD", moverIsOurs: false });
  return false;
};

/** Первое свободное имя `<слаг>-<n>.md` рядом с пунктом: в индексе такого файла нет. */
const freeEntryPath = async (ports: GitPorts, path: string): Promise<string> => {
  const stem = path.replace(/\.md$/, "");
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}-${n}.md`;
    if (((await show(ports, trackedPathArgs(candidate))) ?? "").trim() === "") return candidate;
  }
};

const resolveChangelog = async (ports: GitPorts, files: TreeFiles, { path, kind }: Unmerged): Promise<boolean> => {
  if (kind !== "both-modified" && kind !== "both-added") return false;
  const [ours, theirs] = [await show(ports, showStageArgs(2, path)), await show(ports, showStageArgs(3, path))];
  if (ours === null || theirs === null) return false;
  const { keep, extra } = mergeChangelog({ base: await show(ports, showStageArgs(1, path)), ours, theirs });
  await settle(ports, files, path, keep, []);
  if (extra !== null) await settle(ports, files, await freeEntryPath(ports, path), extra, []);
  return true;
};

/** Сводит файл задачи или пункт ченж-лога; `false` — этот конфликт сам не сводится. */
export const resolveConflict = (ports: GitPorts, files: TreeFiles, conflict: Unmerged, kind: "task" | "changelog"): Promise<boolean> =>
  kind === "task" ? resolveTask(ports, files, conflict) : resolveChangelog(ports, files, conflict);

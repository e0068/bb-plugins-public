// Слой 3 — отметка «ждёт» (core/pr-await.ts) в git-каталоге рабочего дерева.
//
// Отметку ставит один процесс, а читает другой: публикацию жмёт шаг Flow, а
// значок строки рисует Automations. KV у плагинов раздельные, память тоже;
// общий у них только репозиторий треда. Конфиг git для этого не годится: он
// один на все деревья репозитория, и залп опроса по всем строкам разом ловит
// «could not lock config file». Поэтому отметка — свой файл в каталоге дерева
// (`git rev-parse --git-path`, у рабочего дерева это `.git/worktrees/<имя>/`):
// у каждого треда свой, общего замка нет, удаляется вместе с деревом. Запись —
// через временный файл и переименование, так читатель не видит половину JSON.
// В файле лежит и имя ветки: основная копия меняет ветку, а отметка — нет.
import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";

import type { AwaitMark } from "../core/pr-await";
import type { GitPorts } from "./git-run";

const FILE = "bb-pr-await.json";

const pathOf = async (git: GitPorts): Promise<string | null> => {
  const run = await git.run(["rev-parse", "--path-format=absolute", "--git-path", FILE]);
  return run.code === 0 ? run.stdout.trim() : null;
};

const isMark = (value: unknown): value is AwaitMark => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<AwaitMark>;
  const found = v.found as Partial<AwaitMark["found"]> | null | undefined;
  return (
    (v.kind === "publish" || v.kind === "merge") &&
    typeof v.since === "number" &&
    (v.askedAt === null || typeof v.askedAt === "number") &&
    (found === null || (typeof found?.number === "number" && typeof found.url === "string"))
  );
};

/** Отметка ветки; нет её, она другой ветки или файл битый — `null`. */
export async function readMark(git: GitPorts, branch: string): Promise<AwaitMark | null> {
  const path = await pathOf(git);
  if (path === null) return null;
  try {
    const stored = JSON.parse(await readFile(path, "utf8")) as { branch?: unknown; mark?: unknown };
    return stored.branch === branch && isMark(stored.mark) ? stored.mark : null;
  } catch {
    return null;
  }
}

/** Пишет отметку или снимает её (`null`); снятие отсутствующей — не ошибка. */
export async function writeMark(git: GitPorts, branch: string, mark: AwaitMark | null): Promise<void> {
  const path = await pathOf(git);
  if (path === null) return;
  if (mark === null) {
    if ((await readMark(git, branch)) !== null) await rm(path, { force: true });
    return;
  }
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify({ branch, mark }));
  await rename(tmp, path);
}

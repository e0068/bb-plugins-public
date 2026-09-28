// Слой 3 (оболочка) — где у ветки кончается то, что уже влито в базу.
//
// PR уезжает в базу одним синтетическим коммитом, собранным через API без
// push: локальная ветка предком базы не становится никогда, и подтягивание
// базы сводит ветку с её же изменениями, вернувшимися «с той стороны».
// Полностью влитую ветку видно проще (merged-content.ts), а вот ветку, которая
// после мёрджа успела поработать дальше, надо разрезать: всё до среза уже
// лежит в базе, всё после — её новая работа. Срез и ищется здесь — самым
// свежим собственным коммитом, чьё содержимое целиком в базе.
//
// Вопрос к каждому коммиту тот же, что и к вершине: слияние в памяти с базой
// даёт дерево самой базы. Смотрим от свежих к старым и останавливаемся на
// первом совпавшем; дальше старых коммитов идти незачем — они влиты тем же
// мёрджем. Предел на число проверок держит цену шага: ветка длиннее предела
// разрезается не здесь, а обычным слиянием.
import type { ResolvedBase } from "../core/base-branch";
import { baseTreeArgs, mergeTreeArgs, ownCommitsArgs } from "../core/git-commands";
import { decideMergedContent } from "../core/merged-content";
import type { GitPorts } from "./git-run";

export const CUTOFF_LIMIT = 20;

export async function findMergedCutoff(
  ports: GitPorts,
  base: ResolvedBase,
  limit: number = CUTOFF_LIMIT,
): Promise<string | null> {
  const listed = await ports.run(ownCommitsArgs(base.statusBase));
  if (listed.code !== 0) return null;
  const own = listed.stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "").slice(0, limit);
  if (own.length === 0) return null;

  const baseTree = await ports.run(baseTreeArgs(base.statusBase));
  if (baseTree.code !== 0) return null;

  for (const sha of own) {
    const mergeTree = await ports.run(mergeTreeArgs(base.statusBase, sha));
    if (decideMergedContent({ mergeTree, baseTree }) === "merged") return sha;
  }
  return null;
}

// Id и подписи шагов без единого импорта: их читает и фронт, в бандл которого
// не должен попасть код эффектов шагов.

/**
 * Шаги в порядке, в котором их обычно ставят в автоматизацию. Три шага бампа
 * стоят сразу за открытием PR: версия пишется коммитом в ветку уже открытого
 * PR, поэтому раньше её ставить некуда, а позже — поздно. Шаг идемпотентен:
 * ветку, уже стоящую выше базы, он не трогает. Поэтому цепочка, которая ещё
 * и мёрджит, проходит его второй раз перед мёрджем — отдельным нажатием
 * «Merge» или своим шагом в цепочке Flow: за время проверок версию мог
 * занять соседний PR. Шаг обновления плагинов идёт после мёрджа: он
 * переводит плагины на смёрдженный код.
 */
export const STEP_IDS = [
  "git.commit",
  "git.fast-forward",
  "git.create-pr",
  "bb.tasks-in-review",
  "files.bump-major",
  "files.bump-minor",
  "files.bump-patch",
  "git.merge",
  "git.pull-main",
  "bb.reinstall",
  "bb.tasks-done",
  "bb.archive",
] as const;

export type StepId = (typeof STEP_IDS)[number];

export const STEP_LABELS: Readonly<Record<StepId, { readonly en: string; readonly ru: string }>> = {
  "git.commit": { en: "Commit", ru: "Commit" },
  "git.fast-forward": { en: "FF Branch ← Main", ru: "FF Branch ← Main" },
  "git.create-pr": { en: "Open a PR", ru: "Открыть PR" },
  "bb.tasks-in-review": { en: "Task → in_review", ru: "Задача → in_review" },
  "files.bump-major": { en: "Bump major", ru: "Bump major" },
  "files.bump-minor": { en: "Bump minor", ru: "Bump minor" },
  "files.bump-patch": { en: "Bump patch", ru: "Bump patch" },
  "git.merge": { en: "Merge the PR", ru: "Смёрджить PR" },
  "git.pull-main": { en: "Pull Main ← Origin", ru: "Pull Main ← Origin" },
  "bb.reinstall": { en: "Update plugins from git", ru: "Обновить плагины с гита" },
  "bb.tasks-done": { en: "Task → done", ru: "Задача → done" },
  "bb.archive": { en: "Archive the thread", ru: "Архивировать тред" },
};

const STEP_SET: ReadonlySet<string> = new Set(STEP_IDS);

export const isStepId = (x: unknown): x is StepId => typeof x === "string" && STEP_SET.has(x);

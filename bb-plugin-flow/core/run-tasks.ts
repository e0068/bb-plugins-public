// Задачи прогона для итога: отдельного списка задач прогон не ведёт, поэтому
// они выводятся из того, что этапы оставили результатами. Так же находятся и
// задачи прогонов, замороженных до того, как итог начал их показывать.
import type { ProgressStage } from "../shared/contract";
import { frontmatter } from "./frontmatter";

/** Задача прогона: адрес, по которому её находит Tasks+ (ключ доски или слаг файла), и название, если этап его запомнил. */
export type RunTask = { address: string; title?: string };

type Result = ProgressStage["results"][number];

const TASK_KEY = /^[A-Z][A-Z0-9]*-\d+$/;
/** Файл задачи лежит в папке своего статуса под docs/tasks; имя файла — слаг задачи. */
const TASK_FILE = /(?:^|\/)docs\/tasks\/[^/]+\/([^/]+)\.md$/;

export const isTaskFile = (target: string): boolean => TASK_FILE.test(target);

const slugOf = (target: string): string | undefined => TASK_FILE.exec(target)?.[1];

/** Название задачи из шапки её файла, без кавычек; шапки или поля нет — `undefined`. */
export const taskTitle = (markdown: string): string | undefined => frontmatter(markdown)?.title?.replace(/^(["'])(.*)\1$/, "$2") || undefined;

/**
 * Ключи доски по слагам файлов задач: этап, назвавший файл задачи ключом, даёт ключ и тому же файлу,
 * названному на другом этапе слагом, — иначе одна задача встала бы в итог дважды.
 */
const keysBySlug = (results: readonly Result[]): ReadonlyMap<string, string> =>
  new Map(
    results.flatMap((result) => {
      const slug = slugOf(result.target);
      return TASK_KEY.test(result.label) && slug !== undefined ? [[slug, result.label] as const] : [];
    }),
  );

/** Адрес задачи результата: ключ доски из подписи, иначе ключ или слаг её файла; не задача — `undefined`. */
const addressIn = (keys: ReadonlyMap<string, string>) => (result: Result): string | undefined => {
  if (TASK_KEY.test(result.label)) return result.label;
  const slug = slugOf(result.target);
  return slug === undefined ? undefined : (keys.get(slug) ?? slug);
};

/** Задачи всех этапов прогона в порядке первого упоминания, каждая один раз, с первым известным названием. */
export const runTasks = (stages: readonly ProgressStage[]): RunTask[] => {
  const results = stages.flatMap((stage) => stage.results);
  const address = addressIn(keysBySlug(results));
  const found = results.flatMap((result) => {
    const at = address(result);
    return at === undefined ? [] : [{ address: at, title: result.title }];
  });
  return [...new Set(found.map((task) => task.address))].map((at) => {
    const title = found.find((task) => task.address === at && task.title !== undefined)?.title;
    return title === undefined ? { address: at } : { address: at, title };
  });
};

/** Маршрут карточки задачи на странице Tasks+. */
export const taskRoute = (address: string): string => `/plugins/tasks-plus/tasks/task/${encodeURIComponent(address)}`;

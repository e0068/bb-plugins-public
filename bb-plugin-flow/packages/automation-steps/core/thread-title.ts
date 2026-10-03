// Слой 1 — какое имя тред получает от своей задачи.
//
// Только название, без ключа: владелец ищет тред в списке по словам, а ключ
// вида BBPL-7 ему ни о чём не говорит. Пустое название — не имя: шаг не
// должен стирать то, что у треда уже есть.
import type { LinkedTask } from "./bb-tasks-commands";
import { oneLine } from "./pr-title";

export const threadTitleOf = (task: LinkedTask): string | null => {
  const title = oneLine(task.title);
  return title === "" ? null : title;
};

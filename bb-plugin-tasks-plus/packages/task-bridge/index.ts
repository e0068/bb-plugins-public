// Мост задач Tasks+ для других плагинов того же окна. SDK даёт плагину открыть
// только свою вкладку панели треда и слышать только свои события, поэтому
// Flow просит Tasks+ событием окна, а Tasks+ отвечает тем же путём. Ни одного
// импорта: пакет вшивается в оба плагина, а сторонний импорт здесь ломает
// git-установку (см. packages/layer-guard, «Сторож git-установки»).

/** Просьба открыть задачу во вкладке Tasks+ в панели треда. */
export const OPEN_TASK_EVENT = "bb-plugins:tasks-plus:open-task";

/** Tasks+ узнал, что задачи изменились, — на доске-папке или в облачной базе. */
export const TASKS_CHANGED_EVENT = "bb-plugins:tasks-plus:tasks-changed";

/** Задача — ключ доски или слаг файла, тред — тот, в чьей панели её открыть. */
export interface OpenTaskRequest {
  taskKey: string;
  threadId: string;
}

const readRequest = (detail: unknown): OpenTaskRequest | null => {
  if (typeof detail !== "object" || detail === null) return null;
  const { taskKey, threadId } = detail as Record<string, unknown>;
  return typeof taskKey === "string" && typeof threadId === "string" ? { taskKey, threadId } : null;
};

/** Просит Tasks+ открыть задачу; `true` — Tasks+ её открыл, `false` — никто не взялся. */
export function requestOpenTask(target: EventTarget, request: OpenTaskRequest): boolean {
  return !target.dispatchEvent(new CustomEvent(OPEN_TASK_EVENT, { detail: request, cancelable: true }));
}

/**
 * Слушает просьбы открыть задачу. `open` отвечает, открыл ли он её; первый
 * открывший забирает просьбу, и следующие слушатели её уже не видят.
 * Возвращает отписку.
 */
export function onOpenTask(target: EventTarget, open: (request: OpenTaskRequest) => boolean): () => void {
  const listener = (event: Event): void => {
    if (event.defaultPrevented) return;
    const request = readRequest((event as CustomEvent<unknown>).detail);
    if (request !== null && open(request)) event.preventDefault();
  };
  target.addEventListener(OPEN_TASK_EVENT, listener);
  return () => target.removeEventListener(OPEN_TASK_EVENT, listener);
}

export function announceTasksChanged(target: EventTarget): void {
  target.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
}

/** Слушает «задачи изменились»; возвращает отписку. */
export function onTasksChanged(target: EventTarget, changed: () => void): () => void {
  const listener = (): void => changed();
  target.addEventListener(TASKS_CHANGED_EVENT, listener);
  return () => target.removeEventListener(TASKS_CHANGED_EVENT, listener);
}

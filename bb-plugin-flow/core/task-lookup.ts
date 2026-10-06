// Задача Tasks+ для карточки в окне Демонстрации. Директиву `::task` Markdown, который bb даёт плагинам, не рисует —
// её понимает только Markdown сообщения, — поэтому Flow спрашивает задачу у Tasks+ сам, его RPC `getTaskByKey`, и
// рисует карточку по коду карточки Tasks+. Здесь — запрос и разбор ответа, без сети.
import { z } from "zod";

export const TASK_STATUSES = ["backlog", "todo", "in_progress", "in_review", "done", "canceled"] as const;
export const TASK_PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** То, что карточка и панель показывают из задачи Tasks+. */
export type TaskView = { key: string; title: string; description: string; status: TaskStatus; priority: TaskPriority };

export type TaskLookup = { kind: "loading" } | { kind: "found"; task: TaskView } | { kind: "not_found" } | { kind: "error" };

/**
 * Адрес задачи — ключ доски (`BBPL-7`) или слаг файла: какой из них, решает Tasks+. Отвергается только строка, которая
 * не адресует задачу никогда, — пустая или с пробелом, как у карточки Tasks+.
 */
export const isTaskAddress = (raw: string): boolean => raw.trim() !== "" && !/\s/.test(raw.trim());

/**
 * Запрос к RPC Tasks+ тем же путём, каким его шлёт хост. Тред брифа уходит полем `callerThreadId`: с ним Tasks+ читает
 * файлы рабочего дерева треда, и задача, заведённая в ветке, находится.
 */
export const taskLookupRequest = (taskKey: string, threadId: string): { url: string; body: string } => ({
  url: "/api/v1/plugins/tasks-plus/rpc/getTaskByKey",
  body: JSON.stringify({ taskKey: taskKey.trim(), callerThreadId: threadId }),
});

const responseSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    task: z
      .object({
        key: z.string(),
        title: z.string(),
        description: z.string(),
        status: z.enum(TASK_STATUSES),
        priority: z.enum(TASK_PRIORITIES),
      })
      .nullable(),
  }),
});

/** Ответ RPC Tasks+ — в состояние карточки. Чужой формат, отказ, нет плагина — `error`, задачи нет — `not_found`. */
export const readTaskLookup = (status: number, body: unknown): TaskLookup => {
  const parsed = status >= 200 && status < 300 ? responseSchema.safeParse(body) : null;
  if (parsed === null || !parsed.success) return { kind: "error" };
  const task = parsed.data.result.task;
  return task === null ? { kind: "not_found" } : { kind: "found", task };
};

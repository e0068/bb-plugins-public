// Слой 1 — чисто. Какие треды держат сообщение в очереди хоста bb: ждущее
// отправки (тред занимает Concurrency limit) или не отправившееся. Хост рисует
// у такой строки свои часики или крестик, и значок плагина их не закрывает.

type QueuedThread = { readonly id: string; readonly queuedWork: "waiting" | "failed" };

const isQueuedThread = (x: unknown): x is QueuedThread => {
  if (typeof x !== "object" || x === null) return false;
  const { id, queuedWork } = x as { id?: unknown; queuedWork?: unknown };
  return typeof id === "string" && (queuedWork === "waiting" || queuedWork === "failed");
};

/**
 * Id тредов с сообщением в очереди из ответа списка тредов хоста. Это внутренний
 * ответ хоста, не SDK: что не массив и что не похоже на тред с очередью — не читается,
 * и ответ-мусор даёт пустое множество.
 */
export const queuedThreadIds = (json: unknown): ReadonlySet<string> =>
  new Set(Array.isArray(json) ? json.filter(isQueuedThread).map((thread) => thread.id) : []);

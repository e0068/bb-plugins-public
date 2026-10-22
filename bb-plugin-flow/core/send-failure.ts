// Почему ответ на бриф не ушёл. Обрыв сети и таймаут bb проходят сами — 21.10 сбой длился минуту, и повтор через
// минуту прошёл, — поэтому они повторяются; отказ сервера повтором не лечится и показывается его словами.

export type SendFailure = { kind: "offline" } | { kind: "timeout" } | { kind: "rejected"; message: string };

/** Паузы перед повторами; вместе — до полуминуты. */
export const SEND_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 13_000];

/** Окно повторов от первой попытки: попытка, которую bb держит до своего таймаута, съедает его, и причина видна через полминуты, а не через минуты. */
export const SEND_RETRY_WINDOW_MS = 30_000;

/** Таймаут команды bb или ответ прокси без тела: bb не успел ответить, а не отказал. */
const TIMED_OUT = /timed out|timeout|\(HTTP 50[234]\)/i;

/** Ошибка вызова RPC: fetch без связи бросает TypeError, bb — Error с `code` и словами сервера. */
export const sendFailureOf = (error: unknown): SendFailure => {
  if (error instanceof TypeError) return { kind: "offline" };
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof Error ? Reflect.get(error, "code") : undefined;
  return code === "command_timeout" || TIMED_OUT.test(message) ? { kind: "timeout" } : { kind: "rejected", message };
};

export const retryable = (failure: SendFailure): boolean => failure.kind !== "rejected";

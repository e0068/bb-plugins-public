import { isCallerScopedMethod, takeCallerThread } from "../shared/enums.js";
import { runInCallerScope } from "../filesync/caller-scope.js";
import type { CallerEnvironmentCache } from "../filesync/caller-cache.js";

type Handler = (input: never) => unknown;

/**
 * Открывает область вызова вокруг задачных обработчиков RPC — то же знание о
 * дереве, которым давно пользуется `bb tasks` (filesync/caller-scope.ts).
 * Обработчик по контракту SDK получает только вход метода, поэтому тред
 * приезжает полем входа, а не отдельным аргументом.
 *
 * Пустое поле означает «спрашивает доска»: обработчик зовётся как есть и
 * работает с main. Недоступное окружение — тоже main: память резолва
 * (filesync/caller-cache.ts) не бросает, и запрос не падает из-за того, что
 * хост не ответил про дерево.
 */
export function withCallerScope<Handlers extends Record<string, Handler>>(
  cache: CallerEnvironmentCache,
  handlers: Handlers,
): Handlers {
  const wrapped: Record<string, Handler> = {};
  for (const [method, handler] of Object.entries(handlers)) {
    wrapped[method] = isCallerScopedMethod(method)
      ? ((input: never) => {
          const { threadId, rest } = takeCallerThread(input);
          const payload = rest as never;
          if (threadId === null) return handler(payload);
          return cache
            .get(threadId)
            .then((environment) => runInCallerScope(environment, async () => handler(payload)));
        }) as Handler
      : handler;
  }
  return wrapped as Handlers;
}

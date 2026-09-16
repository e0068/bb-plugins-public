import { createContext, useContext, type ReactNode } from "react";

import { addCallerThread } from "../shared/enums.js";

/** Тред, из которого смотрит поверхность. null — смотрит доска. */
const CallerThreadContext = createContext<string | null>(null);

/**
 * Объявляет тред для всего поддерева. Внутри него задачные вызовы RPC уезжают
 * с `callerThreadId`, и сервер читает файлы рабочего дерева этого треда
 * (api/caller-scope.ts). Провайдер ставят поверхности треда — панель задачи и
 * кнопка в шапке; доска его не ставит и остаётся на main.
 */
export function CallerThreadProvider({
  threadId,
  children,
}: {
  threadId: string;
  children: ReactNode;
}) {
  return (
    <CallerThreadContext.Provider value={threadId}>{children}</CallerThreadContext.Provider>
  );
}

export function useCallerThreadId(): string | null {
  return useContext(CallerThreadContext);
}

/**
 * Подмешивает тред во вход задачного метода. Правило живёт в
 * `shared/enums.ts` — вместе с именем поля и обратной операцией, которой
 * пользуется сервер: так переименование поля не разойдётся на половины.
 * Модуль правил нарочно не знает `shared/contract.ts`: тот тянет серверный
 * SDK, которого во фронтенд-бандле нет.
 */
export function withCallerThreadInput(
  method: string,
  input: unknown,
  threadId: string | null,
): unknown {
  return addCallerThread(method, input, threadId);
}

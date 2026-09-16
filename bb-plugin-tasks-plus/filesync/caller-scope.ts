import { AsyncLocalStorage } from "node:async_hooks";
import type { CallerEnvironment } from "./caller-root.js";

/**
 * Окружение вызывающего треда на время одной команды. Через процесс плагина
 * идут вызовы нескольких тредов сразу, поэтому общего изменяемого поля здесь
 * быть не может: оно перепутало бы деревья двух одновременных команд.
 * AsyncLocalStorage держит значение внутри одной цепочки await и только её.
 */
const scope = new AsyncLocalStorage<CallerEnvironment | null>();

/** Выполняет команду, зная, из какого дерева она пришла. */
export function runInCallerScope<T>(
  caller: CallerEnvironment | null,
  run: () => Promise<T>,
): Promise<T> {
  return scope.run(caller, run);
}

/** Окружение текущего вызова; null вне области — запрос от интерфейса. */
export function currentCallerEnvironment(): CallerEnvironment | null {
  return scope.getStore() ?? null;
}

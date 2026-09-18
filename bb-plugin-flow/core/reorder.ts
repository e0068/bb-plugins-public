// Перестановка строк таблицы этапов: перетаскивание в секции настроек сводится
// к двум чистым функциям — куда встаёт строка и как меняется список.

/** Список, где строка `from` стоит на месте `to`; номер за пределами списка ничего не меняет. */
export const moveItem = <T>(list: readonly T[], from: number, to: number): T[] => {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return [...list];
  const rest = list.filter((_, i) => i !== from);
  return [...rest.slice(0, to), list[from]!, ...rest.slice(to)];
};

/** Место строки под указателем: сколько середин строк таблицы выше него, не дальше последнего места. */
export const dropIndex = (middles: readonly number[], pointerY: number): number =>
  Math.min(middles.filter((middle) => middle < pointerY).length, Math.max(0, middles.length - 1));

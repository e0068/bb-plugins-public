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

/** Место несомой строки среди остальных: сколько середин других строк выше указателя. Сама она в счёт не идёт. */
export const placeAmong = (middles: readonly number[], grabbed: number, pointerY: number): number =>
  middles.filter((middle, i) => i !== grabbed && middle < pointerY).length;

/** Стык, который подсвечивается: несомая строка встанет перед этой строкой или, на последнем месте, после неё. */
export const dropSeam = (ids: readonly string[], grabbed: string, to: number): { id: string; side: "before" | "after" } | null => {
  const others = ids.filter((id) => id !== grabbed);
  const last = others[others.length - 1];
  if (last === undefined) return null;
  return to < others.length ? { id: others[to]!, side: "before" } : { id: last, side: "after" };
};

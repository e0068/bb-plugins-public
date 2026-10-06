// Этап под указателем, когда строку таблицы этапов тащат: какая строка и какая четверть её высоты. Чисто: рамки строк —
// аргумент, а не чтение DOM. Соседние строки одного этапа — связка этапа-flow — сводятся в одну рамку.
import type { DropZone } from "./sub-stages";

/** Рамка строки таблицы по вертикали; `id` — этап, которому строка принадлежит. */
export type RowBox = { id: string; top: number; bottom: number };

/** Этап под указателем и четверть его высоты. */
export type Hover = { target: string; zone: DropZone };

const mergeRows = (rows: readonly RowBox[], next: RowBox): RowBox[] => {
  const prev = rows[rows.length - 1];
  return prev?.id === next.id ? [...rows.slice(0, -1), { ...prev, bottom: next.bottom }] : [...rows, next];
};

/** Выше таблицы — верх первого этапа, ниже — низ последнего; строк нет — `null`. Зазор между строками — верхняя четверть следующей. */
export const hoverAt = (rows: readonly RowBox[], y: number): Hover | null => {
  const boxes = rows.reduce(mergeRows, []);
  const first = boxes[0];
  const last = boxes[boxes.length - 1];
  if (first === undefined || last === undefined) return null;
  if (y < first.top) return { target: first.id, zone: 1 };
  if (y >= last.bottom) return { target: last.id, zone: 4 };
  const box = boxes.find(({ bottom }) => y < bottom) ?? last;
  return { target: box.id, zone: Math.min(4, Math.max(1, Math.floor(((y - box.top) / (box.bottom - box.top)) * 4) + 1)) as DropZone };
};

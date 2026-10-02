// Где встаёт всплывашка поля, чтобы остаться в окне: вниз или вверх от поля, на сколько сдвинуться вбок и какой
// высоты быть. Чисто: размеры поля, всплывашки и окна — аргументы, а не чтение DOM.
import { clampToViewport, VIEWPORT_MARGIN_PX, type Size } from "@bb-plugins/viewport-clamp/core";

/** Зазор между полем и всплывашкой — `mt-1`. */
const GAP_PX = 4;

/** Доля окна, выше которой всплывашка не растёт: дальше её список листается внутри. */
export const POPOVER_MAX_SHARE = 0.7;

type FieldBox = { top: number; bottom: number; left: number };

/** `up` — всплывашка над полем, `dx` — сдвиг от левого края поля, `maxHeight` — её потолок в пикселях. */
export type PopoverPlace = { up: boolean; dx: number; maxHeight: number };

/**
 * Вниз, пока содержимое там помещается или сверху места не больше; иначе вверх. Потолок — меньшее из 70% окна и места
 * с выбранной стороны; по горизонтали всплывашка сдвигается внутрь окна с тем же отступом от края, что у тултипов.
 */
export const popoverPlace = (field: FieldBox, popover: Size, viewport: Size): PopoverPlace => {
  const below = viewport.height - field.bottom - GAP_PX - VIEWPORT_MARGIN_PX;
  const above = field.top - GAP_PX - VIEWPORT_MARGIN_PX;
  const up = popover.height > below && above > below;
  const cap = Math.floor(viewport.height * POPOVER_MAX_SHARE);
  const x = clampToViewport({ x: field.left, y: 0 }, { width: popover.width, height: 0 }, viewport).x;
  return { up, dx: x - field.left, maxHeight: Math.max(0, Math.min(cap, up ? above : below)) };
};

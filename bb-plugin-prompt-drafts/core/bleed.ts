// Слой 3 — ядро: насколько ряд карточек выходит за колонку композера.
//
// Ряд тянется до краёв блока, который обрезает страницу, — карточки уезжают
// под край панели, а не обрываются по ширине композера.

/** Горизонтальный отрезок в пикселях окна. */
export interface Span {
  readonly left: number;
  readonly right: number;
}

/** Выход колонки до краёв обрезающего блока с каждой стороны: целые пиксели, не меньше нуля. */
export function edgeBleed(column: Span, clip: Span): Span {
  return {
    left: Math.max(0, Math.floor(column.left - clip.left)),
    right: Math.max(0, Math.floor(clip.right - column.right)),
  };
}

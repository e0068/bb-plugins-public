// Чистая геометрия резайза — без DOM, чтобы покрывалась тестами.
// Сторона пана определяет знак: у правого пана ручка слева (тянем влево —
// шире), у левого пана ручка справа (тянем вправо — шире).

export type PaneSide = "left" | "right";

export function clampWidth(value: number, min: number, max: number): number {
  // NaN не сравнивается — отдаём безопасный минимум. ±Infinity зажимаются
  // естественно через min/max: +Inf → max, −Inf → min.
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function nextWidthFromDrag(
  startWidth: number,
  startX: number,
  currentX: number,
  min: number,
  max: number,
  side: PaneSide = "right",
): number {
  const delta = side === "right" ? startX - currentX : currentX - startX;
  return clampWidth(startWidth + delta, min, max);
}

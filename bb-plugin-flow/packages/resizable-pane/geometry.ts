// Pure resize geometry — no DOM, so it's covered by tests.
// The pane's side determines the sign: a right pane's handle is on the left
// (drag left — wider), a left pane's handle is on the right (drag right — wider).

export type PaneSide = "left" | "right";

export function clampWidth(value: number, min: number, max: number): number {
  // NaN doesn't compare — fall back to a safe minimum. ±Infinity clamp
  // naturally via min/max: +Inf → max, −Inf → min.
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

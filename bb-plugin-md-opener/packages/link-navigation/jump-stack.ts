/**
 * Чистый стек прыжков (без react). Immutable-хелперы: каждая функция
 * возвращает новое состояние (или то же самое, если менять нечего — jumpTo
 * тем же путём подряд не даёт дубля).
 */

export interface JumpState {
  stack: string[];
}

export function initStack(first: string): JumpState {
  return { stack: [first] };
}

export function current(s: JumpState): string | null {
  return s.stack.length > 0 ? s.stack[s.stack.length - 1] : null;
}

export function canGoBack(s: JumpState): boolean {
  return s.stack.length > 1;
}

// Толкает новый путь; если abs совпадает с текущим — состояние не меняется
// (возвращается тот же объект), дубль подряд не появляется.
export function jumpTo(s: JumpState, abs: string): JumpState {
  if (current(s) === abs) return s;
  return { stack: [...s.stack, abs] };
}

// Снимает верхний элемент, если есть куда возвращаться; на корне — no-op.
export function goBack(s: JumpState): JumpState {
  if (s.stack.length <= 1) return s;
  return { stack: s.stack.slice(0, -1) };
}

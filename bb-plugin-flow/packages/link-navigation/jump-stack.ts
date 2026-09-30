/**
 * A pure jump stack (no react). Immutable helpers: every function returns a
 * new state (or the same one, if there's nothing to change — jumpTo to the
 * same path in a row doesn't produce a duplicate).
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

// Pushes a new path; if abs matches the current one, the state doesn't change
// (the same object is returned), so a duplicate in a row never appears.
export function jumpTo(s: JumpState, abs: string): JumpState {
  if (current(s) === abs) return s;
  return { stack: [...s.stack, abs] };
}

// Pops the top element if there's somewhere to go back to; at the root — no-op.
export function goBack(s: JumpState): JumpState {
  if (s.stack.length <= 1) return s;
  return { stack: s.stack.slice(0, -1) };
}

/**
 * A partial update as callers actually build it: `{ name: flag, color: flag }`
 * where an unset flag is `undefined`. Spread over the current record that
 * would ERASE the field — and, persisted as JSON, erase it for good, so the
 * record comes back failing its own schema (this is how a board once lost its
 * name, project link and tasks folder to a bare `--rename-prefix`). Only the
 * fields the caller actually set take part in the merge; `null` stays a real
 * value that clears a field on purpose.
 */
export function applyPatch<T extends object>(current: T, patch: Partial<NoInfer<T>>): T {
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
  return { ...current, ...defined };
}

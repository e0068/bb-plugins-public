/**
 * The tasks a side panel has shown, newest last: the panel's own back stack,
 * so a sub-task or parent opened there stays in the panel and «Back» returns
 * to the task before it. Addresses are whatever the panel was given — a board
 * key or a keyless task's slug.
 */
export interface TaskTrail {
  readonly current: string;
  readonly previous: readonly string[];
}

export const startTrail = (taskKey: string): TaskTrail => ({ current: taskKey, previous: [] });

/** Reopening the task already shown leaves no step to go back through. */
export const openInTrail = (trail: TaskTrail, taskKey: string): TaskTrail =>
  taskKey === trail.current
    ? trail
    : { current: taskKey, previous: [...trail.previous, trail.current] };

export const previousInTrail = (trail: TaskTrail): string | null =>
  trail.previous.at(-1) ?? null;

export const backInTrail = (trail: TaskTrail): TaskTrail => {
  const previous = previousInTrail(trail);
  return previous === null
    ? trail
    : { current: previous, previous: trail.previous.slice(0, -1) };
};

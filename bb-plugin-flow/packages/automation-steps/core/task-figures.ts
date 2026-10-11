// Layer 1 — the plan and the spend of a run as `bb tasks update` argv, and the
// spend of every run that worked on a task. Zero effects: the steps that
// write them live in ../wiring/task-figures.ts.

/** The budget the owner released the run with: minutes, target and ceiling in dollars. */
export interface PlannedFigures {
  readonly minutes: number | null;
  readonly target: number;
  readonly max: number;
}

/** What a run spent: active minutes of its stages and dollars. */
export interface SpentFigures {
  readonly minutes: number;
  readonly cost: number;
}

/**
 * A run's spend under the run's id: the key that keeps one run from being
 * counted twice. `aliases` — keys the same run was written under before; the
 * entry under `run` replaces them.
 */
export interface RunSpend extends SpentFigures {
  readonly run: string;
  readonly aliases?: readonly string[];
}

/** The spend of each run that worked on one task, by run id. */
export type Contributions = Readonly<Record<string, SpentFigures>>;

/**
 * A run's name when its own id is unknown — a summary frozen before it kept
 * the id: the thread that carried it and the start of its first stage.
 */
export const runKey = (thread: string, startedAt: string): string => `${thread}@${startedAt}`;

const wholeMinutes = (n: number): string => String(Math.max(0, Math.round(n)));
const cents = (n: number): number => Math.max(0, Math.round(n * 100) / 100);
const dollars = (n: number): string => String(cents(n));
// The spend is rounded down: a task never shows more than was spent. The
// epsilon keeps 0.29 from reading as 0.28 through 28.999… cents.
export const spentMinutes = (n: number): number => Math.max(0, Math.floor(n + 1e-6));
export const spentDollars = (n: number): number => Math.max(0, Math.floor(n * 100 + 1e-6) / 100);

export function planArgs(key: string, planned: PlannedFigures): string[] {
  const minutes = planned.minutes === null ? [] : ["--minutes", wholeMinutes(planned.minutes)];
  return ["tasks", "update", key, ...minutes, "--budget", dollars(planned.target), "--limit", dollars(planned.max), "--json"];
}

export function factArgs(key: string, spent: SpentFigures): string[] {
  return ["tasks", "update", key, "--minutes-actual", String(spentMinutes(spent.minutes)), "--cost", String(spentDollars(spent.cost)), "--json"];
}

/**
 * One task's part of a run that worked on several: the run's spend split
 * evenly, so the tasks of one thread together show what the thread spent,
 * not that much once per task.
 */
export function shareOf(spent: SpentFigures, tasks: number): SpentFigures {
  const n = Math.max(1, tasks);
  return { minutes: spent.minutes / n, cost: spent.cost / n };
}

/**
 * A run's spend replaces its own earlier entry: the step runs again on a
 * retry or a rework, and adding the same run twice would count more than was
 * spent. Another run on the same task — a later one of the same thread, or
 * one of another thread — adds its own entry.
 */
export function withContribution(stored: Contributions, runId: string, spent: SpentFigures, aliases: readonly string[] = []): Contributions {
  const kept = Object.fromEntries(Object.entries(stored).filter(([id]) => !aliases.includes(id)));
  return { ...kept, [runId]: { minutes: spent.minutes, cost: spent.cost } };
}

export function totalOf(contributions: Contributions): SpentFigures {
  const all = Object.values(contributions);
  return {
    minutes: all.reduce((sum, s) => sum + s.minutes, 0),
    // Rounded far below a cent: the sum must not depend on the order the runs wrote in.
    cost: Math.round(all.reduce((sum, s) => sum + s.cost, 0) * 1e6) / 1e6,
  };
}

const isSpent = (x: unknown): x is SpentFigures =>
  typeof x === "object" && x !== null && Number.isFinite((x as SpentFigures).minutes) && Number.isFinite((x as SpentFigures).cost);

/** Contributions as stored in kv; anything unreadable reads as none, an unreadable entry is dropped. */
export function parseContributions(value: unknown): Contributions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, SpentFigures] => isSpent(entry[1])));
}

// A thread's "family" — itself plus every thread it spawned, children of
// children included — and the sum of the usage of a family's threads. Pure:
// the service lists the threads and reads each one's usage, this module only
// decides who belongs to the family and adds the numbers up.
import { cacheWriteTotal } from "./format";
import type { TokensCostBreakdown, TokensTotals } from "./types";

/** The part of a bb thread that decides family membership. */
export interface ThreadNode {
  id: string;
  /** The thread that started this one; null for a thread of its own. */
  parentThreadId: string | null;
  title: string | null;
}

/**
 * The thread and all its descendants: the thread first, then its children,
 * then theirs, level by level, siblings in the order of `threads`. Each thread
 * appears once, so a parent link loop cannot spin it. A thread missing from
 * `threads` (older than the scanned window) is still named, untitled.
 */
export function familyOf(rootId: string, threads: readonly ThreadNode[]): ThreadNode[] {
  const root = threads.find((thread) => thread.id === rootId) ?? { id: rootId, parentThreadId: null, title: null };
  const childrenOf = threads.reduce<ReadonlyMap<string, readonly ThreadNode[]>>(
    (byParent, thread) =>
      thread.parentThreadId === null ? byParent : new Map(byParent).set(thread.parentThreadId, [...(byParent.get(thread.parentThreadId) ?? []), thread]),
    new Map(),
  );
  const descend = (level: readonly ThreadNode[], seen: ReadonlySet<string>): ThreadNode[] => {
    const next = level
      .flatMap((thread) => childrenOf.get(thread.id) ?? [])
      .filter((thread, index, all) => !seen.has(thread.id) && all.findIndex((other) => other.id === thread.id) === index);
    return next.length === 0 ? [] : [...next, ...descend(next, new Set([...seen, ...next.map((thread) => thread.id)]))];
  };
  return [root, ...descend([root], new Set([root.id]))];
}

/** What one thread's session — or a whole family — used: counters, cost and the cost by kind. */
export interface UsageTotals {
  total: number;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  thinking: number;
  messages: number;
  cost: number;
  /** Models without a known price: `cost` is a partial sum when present. */
  unpricedModels?: string[];
  costs: TokensCostBreakdown;
}

const withUnpriced = (models: readonly string[]): { unpricedModels?: string[] } => (models.length === 0 ? {} : { unpricedModels: [...models] });

/** One report's grand totals as usage totals — the two cache-write lifetimes become one counter. */
export function usageTotalsOf(report: TokensTotals): UsageTotals {
  return {
    total: report.total,
    input: report.input,
    cacheWrite: cacheWriteTotal(report),
    cacheRead: report.cacheRead,
    output: report.output,
    thinking: report.thinking,
    messages: report.messages,
    cost: report.cost,
    ...withUnpriced(report.unpricedModels ?? []),
    costs: report.costs,
  };
}

/** Money sums kept on whole cents: the parts are priced to the cent, a floating-point tail is not a price. */
const toCents = (usd: number): number => Math.round(usd * 100) / 100;

const sumBy = <T>(items: readonly T[], read: (item: T) => number): number => items.reduce((sum, item) => sum + read(item), 0);

/** Usage of several threads added up; zeros for none. */
export function sumTotals(list: readonly UsageTotals[]): UsageTotals {
  const cost = (kind: keyof TokensCostBreakdown) => toCents(sumBy(list, (totals) => totals.costs[kind]));
  return {
    total: sumBy(list, (totals) => totals.total),
    input: sumBy(list, (totals) => totals.input),
    cacheWrite: sumBy(list, (totals) => totals.cacheWrite),
    cacheRead: sumBy(list, (totals) => totals.cacheRead),
    output: sumBy(list, (totals) => totals.output),
    thinking: sumBy(list, (totals) => totals.thinking),
    messages: sumBy(list, (totals) => totals.messages),
    cost: toCents(sumBy(list, (totals) => totals.cost)),
    ...withUnpriced([...new Set(list.flatMap((totals) => totals.unpricedModels ?? []))].sort()),
    costs: { input: cost("input"), cacheWrite: cost("cacheWrite"), cacheRead: cost("cacheRead"), output: cost("output"), thinking: cost("thinking") },
  };
}

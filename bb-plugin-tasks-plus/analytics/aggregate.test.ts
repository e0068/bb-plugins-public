import { describe, expect, it } from "vitest";

import type { StatusTransition } from "../db/transition-log.js";
import type { Task } from "../shared/contract.js";
import { seriesFromTransitions, snapshotOf, UNTYPED_KEY } from "./aggregate";

function task(over: Partial<Task> = {}): Task {
  return {
    id: "TSK-1",
    projectId: "P",
    number: 1,
    key: "TSK-1",
    title: "T",
    description: "",
    status: "backlog",
    priority: "none",
    type: null,
    estimate: null,
    plannedMinutes: null,
    actualMinutes: null,
    budget: null,
    budgetLimit: null,
    cost: null,
    dueDate: null,
    parentTaskId: null,
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    labelIds: [],
    checks: [],
    source: null,
    ...over,
  };
}

function transition(over: Partial<StatusTransition> = {}): StatusTransition {
  return { taskId: "TSK-1", projectId: "P", fromStatus: "todo", toStatus: "in_progress", atMs: 0, actor: null, ...over };
}

describe("snapshotOf", () => {
  it("is all-zeroes on an empty set", () => {
    const snap = snapshotOf([]);
    expect(snap.total).toBe(0);
    expect(snap.plannedMinutes).toBe(0);
    expect(snap.actualMinutes).toBe(0);
    expect(snap.budget).toBe(0);
    expect(snap.budgetLimit).toBe(0);
    expect(snap.cost).toBe(0);
    expect(Object.values(snap.byStatus).every((n) => n === 0)).toBe(true);
  });

  it("counts every task once across status/priority/type — the buckets sum to the total", () => {
    const tasks = [
      task({ status: "todo", priority: "high", type: "feature" }),
      task({ status: "todo", priority: "low", type: "bugfix" }),
      task({ status: "done", priority: "high", type: null }),
    ];
    const snap = snapshotOf(tasks);
    expect(snap.total).toBe(3);
    expect(snap.byStatus.todo).toBe(2);
    expect(snap.byStatus.done).toBe(1);
    expect(snap.byPriority.high).toBe(2);
    expect(snap.byType.feature).toBe(1);
    expect(snap.byType[UNTYPED_KEY]).toBe(1);
    // Each grouping is a partition — its counts sum to the total.
    for (const group of [snap.byStatus, snap.byPriority, snap.byType]) {
      expect(Object.values(group).reduce((a, b) => a + b, 0)).toBe(snap.total);
    }
  });

  it("sums non-null time and money and skips nulls", () => {
    const snap = snapshotOf([
      task({ plannedMinutes: 60, actualMinutes: 45, budget: 10.1, budgetLimit: 20, cost: 7.25 }),
      task({ plannedMinutes: null, actualMinutes: 30, budget: 0.2, budgetLimit: null, cost: null }),
      task({ plannedMinutes: 15, actualMinutes: null, budget: null, budgetLimit: 5.5, cost: 2.5 }),
    ]);
    expect(snap.plannedMinutes).toBe(75);
    expect(snap.actualMinutes).toBe(75);
    // Money sums stay on whole cents — 10.1 + 0.2 must not read 10.299999….
    expect(snap.budget).toBe(10.3);
    expect(snap.budgetLimit).toBe(25.5);
    expect(snap.cost).toBe(9.75);
  });
});

describe("seriesFromTransitions", () => {
  const window = { fromMs: 0, toMs: 30, binMs: 10 }; // three bins: [0,10) [10,20) [20,30)

  it("counts all transitions per bin, conserving the in-window total", () => {
    const transitions = [
      transition({ atMs: 1 }),
      transition({ atMs: 5 }),
      transition({ atMs: 15 }),
      transition({ atMs: 25 }),
    ];
    const series = seriesFromTransitions(transitions, window);
    expect(series.bins).toEqual([0, 10, 20]);
    expect(series.total).toEqual([2, 1, 1]);
    expect(series.total.reduce((a, b) => a + b, 0)).toBe(transitions.length);
  });

  it("splits the count by destination status, each series sharing the grid", () => {
    const transitions = [
      transition({ atMs: 1, toStatus: "in_progress" }),
      transition({ atMs: 2, toStatus: "done" }),
      transition({ atMs: 15, toStatus: "done" }),
    ];
    const series = seriesFromTransitions(transitions, window);
    expect(series.byToStatus.in_progress).toEqual([1, 0, 0]);
    expect(series.byToStatus.done).toEqual([1, 1, 0]);
    // Every per-status series has one value per bin.
    for (const values of Object.values(series.byToStatus)) {
      expect(values).toHaveLength(series.bins.length);
    }
    // The per-status series sum, bin by bin, to the total series.
    series.total.forEach((totalInBin, i) => {
      const sumOfStatuses = Object.values(series.byToStatus).reduce((acc, values) => acc + values[i], 0);
      expect(sumOfStatuses).toBe(totalInBin);
    });
  });

  it("counts a transition into an unknown status in total but in no per-status series", () => {
    // The log is neutral about the status vocabulary (toStatus is a string), so
    // pin the documented gap: an out-of-vocabulary target still lands in total.
    const series = seriesFromTransitions([transition({ atMs: 5, toStatus: "archived" })], window);
    expect(series.total).toEqual([1, 0, 0]);
    for (const values of Object.values(series.byToStatus)) {
      expect(values.reduce((a, b) => a + b, 0)).toBe(0);
    }
  });

  it("still emits the full grid of zeroes when no transition falls in the window", () => {
    const series = seriesFromTransitions([transition({ atMs: 999 })], window);
    expect(series.bins).toEqual([0, 10, 20]);
    expect(series.total).toEqual([0, 0, 0]);
  });

  it("returns empty arrays on a degenerate window", () => {
    const series = seriesFromTransitions([transition({ atMs: 5 })], { fromMs: 0, toMs: 10, binMs: 0 });
    expect(series.bins).toEqual([]);
    expect(series.total).toEqual([]);
    expect(series.byToStatus.in_progress).toEqual([]);
  });
});

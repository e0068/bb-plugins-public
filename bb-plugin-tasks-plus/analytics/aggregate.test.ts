import { describe, expect, it } from "vitest";

import type { Task } from "../shared/contract.js";
import { snapshotOf, UNTYPED_KEY } from "./aggregate";

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
    startDate: null,
    parentTaskId: null,
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    labelIds: [],
    source: null,
    ...over,
  };
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

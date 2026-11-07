// Layer: shared, pure. The totals under the table of an analytics tile — for
// each chosen column the number of distinct values, their sum or their
// median — docs/specs/BBPL-1038-itogi-stolbcov-pod-tablicei-analitiki.md.
// Plain functions of the tasks and the facts, so the same formulas can move to
// another table as they are.
import { roundToCents } from "./amounts.js";
import type { ColumnTotal } from "./analytics-tile.js";
import type { Task } from "./contract.js";
import { isNumberField, type QueryField } from "./enums.js";
import { numberValue, sortValue, type TaskFacts } from "./task-fields.js";

/** A column's total for the tasks; null where there is nothing to total. */
export interface ColumnTotalValue {
  column: QueryField;
  value: number | null;
}

/** The values a task holds in a column that count as distinct: each label and each thread on its own, the sort value otherwise. */
function valuesOf(column: QueryField, task: Task, facts: TaskFacts): readonly (string | number)[] {
  switch (column) {
    case "labels":
      return task.labelIds.map((id) => facts.labelNames.get(id) ?? id);
    case "threads":
      return facts.threadTitles.get(task.id) ?? [];
    default: {
      const value = sortValue(column, task, facts);
      return value === null ? [] : [value];
    }
  }
}

/** The numbers the tasks hold in a column; none in a column that is no number. */
const numbersOf = (column: QueryField, tasks: readonly Task[], facts: TaskFacts): number[] =>
  isNumberField(column)
    ? tasks.flatMap((task) => {
        const value = numberValue(column, task, facts);
        return value === null ? [] : [value];
      })
    : [];

const medianOf = (numbers: readonly number[]): number | null => {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/** One total over the tasks. A sum or a median of a column that is no number has no value. */
function totalOf({ column, fn }: ColumnTotal, tasks: readonly Task[], facts: TaskFacts): number | null {
  switch (fn) {
    case "unique":
      return new Set(tasks.flatMap((task) => valuesOf(column, task, facts))).size;
    case "sum": {
      const numbers = numbersOf(column, tasks, facts);
      return numbers.length === 0 ? null : roundToCents(numbers.reduce((total, value) => total + value, 0));
    }
    case "median":
      return medianOf(numbersOf(column, tasks, facts));
  }
}

/** The totals asked for, in the order asked, over every one of the tasks. */
export const columnTotals = (tasks: readonly Task[], totals: readonly ColumnTotal[], facts: TaskFacts): ColumnTotalValue[] =>
  totals.map((total) => ({ column: total.column, value: totalOf(total, tasks, facts) }));

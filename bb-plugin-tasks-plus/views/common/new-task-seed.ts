import type { Label } from "../../shared/contract.js";
import { boardIdOf } from "../../shared/format.js";
import type {
  TaskEstimate,
  TaskPriority,
  TaskStatus,
  TaskType,
} from "../../shared/enums.js";
import type { ListFilterState } from "./filter-state.js";

/**
 * What a new-task draft starts with when it is opened from a list: the list's
 * project and one value per filtered field, so the created task lands in the
 * list it was made from. Type-only imports keep this module free of the SDK
 * runtime — the dialog and the shell both load it.
 */
export interface NewTaskSeed {
  projectId: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  type: TaskType | null;
  estimate: TaskEstimate | null;
  assignee: string | null;
  /** The first filtered parent: a task made in a parent's list goes under it. */
  parentTaskId: string | null;
  /** Labels travel by name: a list can span projects, a label cannot. */
  labelNames: string[];
}

/** The draft the dialog opens with when nothing is filtered. */
export const EMPTY_SEED: NewTaskSeed = {
  projectId: null,
  status: "todo",
  priority: "none",
  type: null,
  estimate: null,
  assignee: null,
  parentTaskId: null,
  labelNames: [],
};

/** The usual value while the filter allows it, else the filter's first value. */
function pick<T>(usual: T, filter: readonly T[]): T {
  return filter.length === 0 || filter.includes(usual) ? usual : filter[0]!;
}

export function newTaskSeed(
  projectId: string | null,
  filters: ListFilterState,
): NewTaskSeed {
  const parent = filters.parents[0] ?? null;
  return {
    // All tasks has no project of its own; a parent's list has the parent's.
    projectId: projectId ?? (parent === null ? null : boardIdOf(parent)),
    status: pick(EMPTY_SEED.status, filters.statuses),
    priority: pick(EMPTY_SEED.priority, filters.priorities),
    type: pick<TaskType | null>(EMPTY_SEED.type, filters.types),
    estimate: pick<TaskEstimate | null>(EMPTY_SEED.estimate, filters.estimates),
    assignee: pick<string | null>(EMPTY_SEED.assignee, filters.assignees),
    parentTaskId: parent,
    labelNames: [...filters.labelNames],
  };
}

/** The project's labels with these names, in the order asked, one per name. */
export function labelIdsByName(
  labels: readonly Label[],
  projectId: string,
  names: readonly string[],
): string[] {
  const own = labels.filter((label) => label.projectId === projectId);
  const ids = names.flatMap((name) => {
    const match = own.find((label) => label.name === name);
    return match === undefined ? [] : [match.id];
  });
  return [...new Set(ids)];
}

// Pure core behind every analytics tile: one answer for any type, axis,
// measure, breakdown, switch, filter and sort a tile is set to
// (docs/specs/analitika-model-plitki-i-agregaciya-po-lyubomu-polyu.md). No
// I/O, no clock — the RPC handler (api/index.ts) hands it the tasks, the
// transition log, the column edges and "now". The measures lean on the same
// helpers the screen's sections used (flow.ts, closed.ts, gantt.ts,
// aggregate.ts), so a tile set like an old section gives its numbers.
//
// The answer is built in four steps: the measure turns tasks and moves into
// events, each with a moment and the status the task stood in then; the
// board's filter and the switch keep some of them; the axis and the
// breakdown place each in its cells; the measure folds each cell to numbers.
import { TASK_ESTIMATES, TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES } from "../db/types.js";
import type { TaskStatus } from "../db/types.js";
import type { StatusTransition } from "../db/transition-log.js";
import { CELL_KEYS_MAX, NONE_KEY, OTHER_KEY, SERIES_LIMIT, type Figure, type YMetric } from "../shared/analytics-tile.js";
import type { Task, Tile, TileAnswer } from "../shared/contract.js";
import { ACTIVITY_VALUES, FIELD_FILTER_KINDS, MAIN_CHECKOUT, type NumberField, type QueryField } from "../shared/enums.js";
import { firstParagraph } from "../shared/first-paragraph.js";
import { slugOf } from "../shared/format.js";
import { planDateMs } from "../shared/plan-date.js";
import { compareByField, numberValue, worktreeOf, type ColumnSort, type TaskFacts } from "../shared/task-fields.js";
import { matchesConditions } from "../shared/tile-conditions.js";
import { snapshotOf } from "./aggregate.js";
import { closedInBins, strictlyIncreasing, type ClosedEntry } from "./closed.js";
import { ascending, columnEnds, columnOf, createdMs, cycleMs, inProjects, median, movesByTask, p90, planFact, sinceOf, statusBefore } from "./flow.js";
import { ganttRowsOf, type GanttRow } from "./gantt.js";

export interface TileInput {
  tile: Tile;
  tasks: readonly Task[];
  transitions: readonly StatusTransition[];
  /** The tile's columns: column `i` is `[edges[i], edges[i + 1])`; the window is `[edges[0], edges[last])`. */
  edges: readonly number[];
  /** Projects picked on the page; empty keeps every project. */
  projectIds: readonly string[];
  /** The switch value picked on the tile; null — all of them. */
  picked: string | null;
  nowMs: number;
  /** Names and counts a field's value needs: projects and labels in board order, task keys, agents, sub-tasks. */
  facts: TaskFacts;
}

export type TileCore = Omit<TileAnswer, "projects" | "logStartMs">;

/** A task at one moment of the measure: where it stood, which column it lands in, which fixed series it feeds. */
interface TileEvent {
  task: Task;
  status: TaskStatus;
  /** The window column of the moment, for time and date axes; null when the axis does not read time. */
  column: number | null;
  /** The closing behind the event, for the measures of closed tasks. */
  closing: ClosedEntry | null;
  /** The fixed series of «Created vs closed». */
  tag: "created" | "closed" | null;
}

/** Statuses that still owe work — the figure «Open». */
const OPEN_STATUSES: readonly TaskStatus[] = ["backlog", "todo", "in_progress", "in_review"];

const METRIC_LABEL: Record<YMetric, string> = {
  count: "Tasks",
  moves: "Status moves",
  created: "Created",
  closed: "Closed",
  createdClosed: "Created vs closed",
  sum: "Sum",
  avg: "Average",
  cycle: "Cycle time",
  accuracy: "Actual ÷ planned",
};

/** The series a measure gives by itself, when no breakdown splits it. */
const MEASURE_SERIES: Record<YMetric, readonly { key: string; label: string }[]> = {
  count: [{ key: "value", label: METRIC_LABEL.count }],
  moves: [{ key: "value", label: METRIC_LABEL.moves }],
  created: [{ key: "value", label: METRIC_LABEL.created }],
  closed: [{ key: "value", label: METRIC_LABEL.closed }],
  createdClosed: [
    { key: "created", label: "Created" },
    { key: "closed", label: "Closed" },
  ],
  sum: [{ key: "value", label: METRIC_LABEL.sum }],
  avg: [{ key: "value", label: METRIC_LABEL.avg }],
  cycle: [
    { key: "median", label: "Median" },
    { key: "p90", label: "p90" },
  ],
  accuracy: [
    { key: "time", label: "Time" },
    { key: "money", label: "Money" },
  ],
};

/** Buckets of a number field, upper bounds exclusive; the last is open. */
const MINUTE_BINS = [
  { below: 30, label: "< 30m" },
  { below: 60, label: "30m–1h" },
  { below: 180, label: "1–3h" },
  { below: Infinity, label: "3h+" },
];
const DOLLAR_BINS = [
  { below: 5, label: "< $5" },
  { below: 20, label: "$5–20" },
  { below: 50, label: "$20–50" },
  { below: Infinity, label: "$50+" },
];
const COUNT_BINS = [
  { below: 1, label: "0" },
  { below: 3, label: "1–2" },
  { below: 6, label: "3–5" },
  { below: Infinity, label: "6+" },
];
const NUMBER_BINS: Record<NumberField, typeof MINUTE_BINS> = {
  plannedMinutes: MINUTE_BINS,
  actualMinutes: MINUTE_BINS,
  budget: DOLLAR_BINS,
  budgetLimit: DOLLAR_BINS,
  cost: DOLLAR_BINS,
  subtasks: COUNT_BINS,
  attachments: COUNT_BINS,
};

/** Characters a description keeps as a category. */
const DESCRIPTION_LABEL = 80;

/** A plan date or a timestamp as a moment; NaN when it does not read. */
function dateMs(field: "dueDate" | "startDate" | "createdAt" | "updatedAt", task: Task): number {
  const value = task[field];
  if (value === null) return Number.NaN;
  return field === "dueDate" || field === "startDate" ? planDateMs(value, "start") : Date.parse(value);
}

const orNone = (value: string | null | undefined): string => (value == null || value === "" ? NONE_KEY : value);

/**
 * The categories a task falls under on a field, the status read as `status`
 * (the one it stood in at the event's moment). Labels give one per label;
 * a date gives its window column, or none outside the window.
 */
function keysOf(field: QueryField, task: Task, status: TaskStatus, input: TileInput): string[] {
  const { facts, edges } = input;
  switch (field) {
    case "status":
      return [status];
    case "priority":
      return [task.priority];
    case "type":
      return [orNone(task.type)];
    case "estimate":
      return [orNone(task.estimate)];
    case "assignee":
      return [orNone(task.assignee)];
    case "parent":
      return [orNone(task.parentTaskId)];
    case "labels":
      return task.labelIds.length === 0 ? [NONE_KEY] : [...task.labelIds];
    case "project":
      return [task.projectId];
    case "flow":
      return [orNone(task.flow?.name)];
    case "worktree":
      return [worktreeOf(task) ?? MAIN_CHECKOUT];
    case "takenBy":
      return [orNone(task.takenBy?.machine)];
    case "active":
      return [(facts.activeCounts.get(task.id) ?? 0) > 0 ? ACTIVITY_VALUES[0] : ACTIVITY_VALUES[1]];
    case "title":
      return [orNone(task.title)];
    case "key":
      return [task.key];
    case "slug":
      return [slugOf(task.id)];
    case "description":
      return [orNone(firstParagraph(task.description).slice(0, DESCRIPTION_LABEL))];
    case "dueDate":
    case "startDate":
    case "createdAt":
    case "updatedAt": {
      const ms = dateMs(field, task);
      const column = Number.isFinite(ms) && edges.length >= 2 ? columnOf(edges, ms) : -1;
      return column < 0 ? [] : [String(column)];
    }
    case "subtasks":
    case "attachments":
    case "plannedMinutes":
    case "actualMinutes":
    case "budget":
    case "budgetLimit":
    case "cost": {
      const value = numberValue(field, task, facts);
      return value === null ? [NONE_KEY] : [NUMBER_BINS[field].find((bin) => value < bin.below)!.label];
    }
  }
}

/** Whether a field's categories are the window's columns, so the axis runs like time. */
const runsLikeTime = (axis: Tile["x"]): boolean => axis === "time" || FIELD_FILTER_KINDS[axis] === "date";

/** A category's name: names the server knows, the raw value otherwise — the client names statuses and the like. */
function labelOf(field: QueryField | "time", key: string, input: TileInput): string {
  if (key === NONE_KEY) return "None";
  if (key === OTHER_KEY) return "Other";
  switch (field) {
    case "project":
      return input.facts.projectNames.get(key) ?? key;
    case "labels":
      return input.facts.labelNames.get(key) ?? key;
    case "parent":
      return input.facts.taskKeys.get(key) ?? input.tasks.find((task) => task.id === key)?.key ?? key;
    default:
      return runsLikeTime(field) ? "" : key;
  }
}

/** The order a field's categories stand in when nothing sorts them: the field's own order, the board's for projects and labels, else by name. */
function canonicalRank(field: QueryField, input: TileInput): (key: string) => number {
  const order = (keys: readonly string[]) => (key: string) => {
    const index = keys.indexOf(key);
    return index < 0 ? keys.length : index;
  };
  switch (field) {
    case "status":
      return order(TASK_STATUSES);
    case "priority":
      return order(TASK_PRIORITIES);
    case "type":
      return order(TASK_TYPES);
    case "estimate":
      return order(TASK_ESTIMATES);
    case "project":
      return order([...input.facts.projectNames.keys()]);
    case "labels":
      return order([...input.facts.labelNames.keys()]);
    default:
      if (FIELD_FILTER_KINDS[field] === "number") return order(NUMBER_BINS[field as NumberField].map((bin) => bin.label));
      return () => 0;
  }
}

/** The events a measure reads, before any filter. */
function eventsOf(input: TileInput, tasks: readonly Task[], moves: Map<string, StatusTransition[]>, edges: readonly number[]): TileEvent[] {
  const { tile } = input;
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const inWindow = (atMs: number) => edges.length >= 2 && columnOf(edges, atMs) >= 0;
  const event = (task: Task, patch: Partial<TileEvent> = {}): TileEvent => ({ task, status: task.status, column: null, closing: null, tag: null, ...patch });
  const closings = () =>
    closedInBins(input.transitions, edges).flatMap((closing) => {
      const task = byId.get(closing.taskId);
      return task === undefined ? [] : [event(task, { column: closing.bin, closing })];
    });
  const created = () =>
    tasks.filter((task) => inWindow(createdMs(task))).map((task) => event(task, { column: columnOf(edges, createdMs(task)) }));

  switch (tile.y.metric) {
    case "count":
      if (tile.x !== "time") return tasks.map((task) => event(task));
      return columnEnds(edges, input.nowMs).flatMap((end, column) =>
        tasks
          .filter((task) => createdMs(task) < end)
          .map((task) => event(task, { status: statusBefore(task, moves.get(task.id) ?? [], end), column })),
      );
    case "moves":
      return input.transitions.flatMap((move) => {
        const task = byId.get(move.taskId);
        const status = TASK_STATUSES.find((value) => value === move.toStatus);
        return task === undefined || status === undefined || !inWindow(move.atMs) ? [] : [event(task, { status, column: columnOf(edges, move.atMs) })];
      });
    case "created":
      return created();
    case "createdClosed":
      return [...created().map((entry) => ({ ...entry, tag: "created" as const })), ...closings().map((entry) => ({ ...entry, tag: "closed" as const }))];
    case "closed":
    case "sum":
    case "avg":
    case "cycle":
    case "accuracy":
      return closings();
  }
}

/** A cell's events folded to one number per measure series. */
function measure(input: TileInput, events: readonly TileEvent[], moves: Map<string, StatusTransition[]>): number[] {
  const { metric, field } = input.tile.y;
  const numbers = () =>
    field === null ? [] : events.map((entry) => numberValue(field, entry.task, input.facts)).filter((value): value is number => value !== null);
  switch (metric) {
    case "count":
    case "moves":
    case "created":
    case "closed":
    case "createdClosed":
      return [events.length];
    case "sum":
      return [numbers().reduce((total, value) => total + value, 0)];
    case "avg": {
      const values = numbers();
      return [values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length];
    }
    case "cycle": {
      const spans = ascending(
        events.flatMap((entry) => {
          const ms = entry.closing === null ? undefined : cycleMs(entry.closing, moves.get(entry.task.id) ?? []);
          return ms === undefined ? [] : [ms];
        }),
      );
      return spans.length === 0 ? [0, 0] : [median(spans), p90(spans)];
    }
    case "accuracy": {
      const tasks = events.map((entry) => entry.task);
      const minutes = planFact(tasks.map((task) => [task.plannedMinutes, task.actualMinutes] as const));
      const money = planFact(tasks.map((task) => [task.budget, task.cost] as const));
      return [minutes?.ratio ?? 0, money?.ratio ?? 0];
    }
  }
}

/** Whether a set of cell values carries anything a cycle or accuracy measure could report. */
const measured = (metric: YMetric, values: readonly number[]) => (metric === "cycle" || metric === "accuracy" ? values.some((value) => value > 0) : true);

/** Events grouped column → series → events, both in first-seen order. */
type Grid = Map<string, Map<string, TileEvent[]>>;

/** Puts an event into its cell. The grid is the answer's own scratch, built and read within one call — appending in place keeps placement linear. */
function place(grid: Grid, column: string, series: string, entry: TileEvent): Grid {
  const row = grid.get(column) ?? grid.set(column, new Map()).get(column)!;
  const cell = row.get(series);
  if (cell === undefined) row.set(series, [entry]);
  else cell.push(entry);
  return grid;
}

/** Keys past `limit` merged into «Other», the kept ones first. */
function capped(keys: readonly string[], limit: number): { kept: string[]; rest: Set<string> } {
  return keys.length <= limit ? { kept: [...keys], rest: new Set() } : { kept: [...keys.slice(0, limit), OTHER_KEY], rest: new Set(keys.slice(limit)) };
}

/** The order of the axis' categories: as sorted, else in the field's own order. */
function orderedColumns(input: TileInput, grid: Grid, totals: ReadonlyMap<string, number>, sortedTasks: readonly Task[], axisKeysOf: (task: Task) => string[]): string[] {
  const { tile } = input;
  const keys = [...grid.keys()];
  if (tile.x === "time") return keys;
  if (runsLikeTime(tile.x)) return keys.sort((a, b) => Number(a) - Number(b));
  const sort = tile.sort;
  if (sort === null || sort.by === "timeInStatus") {
    const rank = canonicalRank(tile.x, input);
    return keys.sort((a, b) => (a === NONE_KEY ? 1 : b === NONE_KEY ? -1 : rank(a) - rank(b) || a.localeCompare(b)));
  }
  if (sort.by === "value") {
    const direction = sort.direction === "asc" ? 1 : -1;
    return keys.sort((a, b) => direction * ((totals.get(a) ?? 0) - (totals.get(b) ?? 0)));
  }
  const seen = sortedTasks.flatMap(axisKeysOf).filter((key) => grid.has(key));
  return [...new Set(seen)];
}

/** Rows of the tile's tasks, for a list or a Gantt. */
function rowsOf(input: TileInput, tasks: readonly Task[], moves: Map<string, StatusTransition[]>, edges: readonly number[]): TileAnswer["rows"] {
  const { tile } = input;
  const ganttish = tile.type === "bars" && tile.bars.length === "range";
  if (tile.type !== "list" && !ganttish) return [];
  const since = (task: Task) => sinceOf(task, moves.get(task.id) ?? []);
  const gantt = ganttish
    ? new Map(ganttRowsOf({ tasks, moves, projectIds: [], fromMs: edges[0] ?? input.nowMs, nowMs: input.nowMs }).map((row) => [row.task.id, row]))
    : new Map<string, GanttRow>();
  const shown = ganttish ? tasks.filter((task) => gantt.has(task.id)) : tasks;
  const sort = tile.sort;
  const sorted =
    sort === null || sort.by === "value"
      ? shown
      : sort.by === "timeInStatus"
        ? [...shown].sort((a, b) => (sort.direction === "desc" ? since(a) - since(b) : since(b) - since(a)))
        : [...shown].sort(compareByField({ column: sort.by, direction: sort.direction }, input.facts));
  return sorted.slice(0, tile.limit).map((task) => {
    const born = createdMs(task);
    return {
      taskId: task.id,
      key: task.key,
      title: task.title,
      projectId: task.projectId,
      parentTaskId: task.parentTaskId,
      status: task.status,
      createdMs: Number.isFinite(born) ? born : null,
      startDate: task.startDate,
      dueDate: task.dueDate,
      segments: gantt.get(task.id)?.segments ?? [],
      doneMs: gantt.get(task.id)?.doneMs ?? null,
      sinceMs: Number.isFinite(since(task)) ? since(task) : null,
    };
  });
}

/** The figures of a «Big numbers» tile over its tasks and its window. */
function figuresOf(input: TileInput, tasks: readonly Task[], moves: Map<string, StatusTransition[]>, edges: readonly number[]): Partial<Record<Figure, number | null>> {
  if (input.tile.type !== "big") return {};
  const snapshot = snapshotOf(tasks);
  const ids = new Set(tasks.map((task) => task.id));
  const closings = closedInBins(input.transitions.filter((move) => ids.has(move.taskId)), edges);
  const spans = ascending(closings.flatMap((closing) => cycleMs(closing, moves.get(closing.taskId) ?? []) ?? []));
  const window = edges.length >= 2 ? edges : [];
  return {
    open: OPEN_STATUSES.reduce((total, status) => total + snapshot.byStatus[status], 0),
    in_progress: snapshot.byStatus.in_progress,
    in_review: snapshot.byStatus.in_review,
    done: snapshot.byStatus.done,
    created: tasks.filter((task) => window.length >= 2 && columnOf(window, createdMs(task)) >= 0).length,
    closed: closings.length,
    cycle: spans.length === 0 ? null : median(spans),
    planned: snapshot.plannedMinutes,
    actual: snapshot.actualMinutes,
    budget: snapshot.budget,
    cost: snapshot.cost,
    limit: snapshot.budgetLimit,
  };
}

/** A pick on the chart: a column's one series, or — series null — the whole column. */
export interface GridPick {
  column: number;
  series: string | null;
}

/**
 * The tile's cells before they are folded to numbers: the switch's values,
 * the tasks shown, the series and the columns kept, and the events in each
 * cell — what the chart counts and the table under it lists.
 */
function tileGrid(input: TileInput) {
  const { tile, facts } = input;
  const edges = input.edges.length >= 2 && strictlyIncreasing(input.edges) ? input.edges : [];
  const tasks = input.tasks.filter((task) => inProjects(input.projectIds, task.projectId));
  const moves = movesByTask(input.transitions.filter((move) => inProjects(input.projectIds, move.projectId)));
  const kept = eventsOf({ ...input, tasks }, tasks, moves, edges).filter((entry) =>
    matchesConditions({ ...entry.task, status: entry.status }, tile.conditions, facts),
  );

  // The switch: its values over what the filter kept, then only the picked one.
  const switchKeys = (entry: TileEvent) => (tile.switch === null ? [] : keysOf(tile.switch, entry.task, entry.status, input));
  const switchTasks = new Map<string, Set<string>>();
  kept.forEach((entry) => switchKeys(entry).forEach((key) => switchTasks.set(key, (switchTasks.get(key) ?? new Set()).add(entry.task.id))));
  const switchRank = tile.switch === null ? () => 0 : canonicalRank(tile.switch, input);
  const switchValues =
    tile.switch === null
      ? []
      : [...switchTasks.entries()]
          .sort(([a], [b]) => (a === NONE_KEY ? 1 : b === NONE_KEY ? -1 : switchRank(a) - switchRank(b)))
          .map(([key, ids]) => ({ key, label: labelOf(tile.switch!, key, input), count: ids.size }));
  const events = input.picked === null || tile.switch === null ? kept : kept.filter((entry) => switchKeys(entry).includes(input.picked!));
  const shownTasks = [...new Map(events.map((entry) => [entry.task.id, entry.task])).values()];
  // Rows and figures read tasks as they stand now, whatever moment the measure reads.
  const currentTasks = tasks.filter((task) => {
    const now = { task, status: task.status, column: null, closing: null, tag: null };
    return matchesConditions(task, tile.conditions, facts) && (input.picked === null || tile.switch === null || switchKeys(now).includes(input.picked));
  });

  // Placement: the axis gives the column, the breakdown — or the measure's own split — the series.
  const metric = tile.y.metric;
  const split = metric === "createdClosed" ? "tag" : tile.breakdown !== null ? "breakdown" : "measure";
  const axisKeysOf = (entry: TileEvent): string[] =>
    tile.x === "time" ? (entry.column === null ? [] : [String(entry.column)]) : keysOf(tile.x, entry.task, entry.status, input);
  const seriesKeysOf = (entry: TileEvent): string[] =>
    split === "tag" ? [entry.tag!] : split === "breakdown" ? keysOf(tile.breakdown!, entry.task, entry.status, input) : ["all"];
  const placed = events.reduce<Grid>(
    (grid, entry) => axisKeysOf(entry).reduce((acc, column) => seriesKeysOf(entry).reduce((inner, series) => place(inner, column, series, entry), acc), grid),
    runsLikeTime(tile.x) ? new Map(Array.from({ length: Math.max(0, edges.length - 1) }, (_, column) => [String(column), new Map()])) : new Map(),
  );

  // Series: the measure's own, or the breakdown's values in their order, the tail as «Other».
  const seriesFound = [...new Set([...placed.values()].flatMap((row) => [...row.keys()]))];
  const seriesRank = split === "breakdown" ? canonicalRank(tile.breakdown!, input) : () => 0;
  const seriesOrdered =
    split === "tag"
      ? ["created", "closed"]
      : split === "measure"
        ? ["all"]
        : seriesFound.sort((a, b) => (a === NONE_KEY ? 1 : b === NONE_KEY ? -1 : seriesRank(a) - seriesRank(b) || a.localeCompare(b)));
  const seriesCap = split === "breakdown" ? capped(seriesOrdered, SERIES_LIMIT) : { kept: seriesOrdered, rest: new Set<string>() };
  const seriesOf = (key: string) => (seriesCap.rest.has(key) ? OTHER_KEY : key);

  // Columns: ordered, capped to the limit when the axis is a field.
  const totals = new Map([...placed].map(([column, row]) => [column, [...row.values()].reduce((total, cell) => total + measure(input, cell, moves)[0]!, 0)]));
  const sortedTasks =
    tile.sort === null || tile.sort.by === "value" || tile.sort.by === "timeInStatus"
      ? shownTasks
      : [...shownTasks].sort(compareByField({ column: tile.sort.by, direction: tile.sort.direction }, facts));
  const columnsOrdered = orderedColumns(input, placed, totals, sortedTasks, (task) => (tile.x === "time" ? [] : keysOf(tile.x, task, task.status, input)));
  const columnCap = runsLikeTime(tile.x) ? { kept: columnsOrdered, rest: new Set<string>() } : capped(columnsOrdered, tile.limit);
  const merged = [...placed].reduce<Grid>((grid, [column, row]) => {
    const target = columnCap.rest.has(column) ? OTHER_KEY : column;
    return [...row].reduce((acc, [series, cell]) => cell.reduce((inner, entry) => place(inner, target, seriesOf(series), entry), acc), grid.has(target) ? grid : grid.set(target, new Map()));
  }, new Map());

  const seriesKeys = split === "measure" ? MEASURE_SERIES[metric].map((series) => series.key) : seriesCap.kept;
  const cellOf = (column: string, index: number) => merged.get(column)?.get(split === "measure" ? "all" : seriesKeys[index]!) ?? [];
  // Each column folded once: its value per series and the keys behind each.
  const folded = new Map(
    columnCap.kept.map((column) => {
      const measureValues = split === "measure" ? measure(input, cellOf(column, 0), moves) : [];
      return [
        column,
        {
          values: seriesKeys.map((_, index) => (split === "measure" ? measureValues[index]! : measure(input, cellOf(column, index), moves)[0]!)),
          keys: seriesKeys.map((_, index) => [...new Set(cellOf(column, index).map((entry) => entry.task.key))].slice(0, CELL_KEYS_MAX)),
        },
      ];
    }),
  );
  const columnKeys = columnCap.kept.filter((column) => merged.has(column) && (runsLikeTime(tile.x) || measured(metric, folded.get(column)!.values)));
  const cellTasks = (column: string, index: number): Task[] => [...new Map(cellOf(column, index).map((entry) => [entry.task.id, entry.task])).values()];
  return { split, metric, seriesKeys, columnKeys, folded, cellTasks, shownTasks, currentTasks, switchValues, moves, edges };
}

export function tileAnswer(input: TileInput): TileCore {
  const { tile } = input;
  const { split, metric, seriesKeys, columnKeys, folded, shownTasks, currentTasks, switchValues, moves, edges } = tileGrid(input);
  const titleOf = new Map(shownTasks.map((task) => [task.key, task.title]));

  return {
    columns: columnKeys.map((key) => ({ key, label: labelOf(tile.x, key, input) })),
    series:
      split === "measure"
        ? [...MEASURE_SERIES[metric]].map((series) => (metric === "sum" || metric === "avg") && tile.y.field !== null ? { ...series, label: `${series.label} of ${tile.y.field}` } : series)
        : split === "tag"
          ? [...MEASURE_SERIES.createdClosed]
          : seriesKeys.map((key) => ({ key, label: labelOf(tile.breakdown!, key, input) })),
    values: columnKeys.map((column) => folded.get(column)!.values),
    cells: columnKeys.map((column) => folded.get(column)!.keys),
    titles: Object.fromEntries([...new Set(columnKeys.flatMap((column) => folded.get(column)!.keys.flat()))].map((key) => [key, titleOf.get(key) ?? key])),
    switchValues,
    total: shownTasks.length,
    rows: rowsOf(input, currentTasks, moves, edges),
    figures: figuresOf(input, currentTasks, moves, edges),
  };
}

/**
 * The tasks behind a pick — every task of the chart while none is picked —
 * each once, in the sort asked or by key, the first `limit` of them, and how
 * many there are in all.
 */
export function segmentTasks(input: TileInput, pick: GridPick | null, sort: ColumnSort | null, limit: number): { tasks: Task[]; total: number } {
  const { seriesKeys, columnKeys, cellTasks } = tileGrid(input);
  const columns = pick === null ? columnKeys : columnKeys.slice(pick.column, pick.column + 1);
  const seriesIndexes = seriesKeys.map((_, index) => index).filter((index) => pick?.series == null || seriesKeys[index] === pick.series);
  const picked = [...new Map(columns.flatMap((column) => seriesIndexes.flatMap((index) => cellTasks(column, index))).map((task) => [task.id, task])).values()];
  const byKey = [...picked].sort(compareByField({ column: "key", direction: "asc" }, input.facts));
  const sorted = sort === null ? byKey : [...byKey].sort(compareByField(sort, input.facts));
  return { tasks: sorted.slice(0, limit), total: sorted.length };
}

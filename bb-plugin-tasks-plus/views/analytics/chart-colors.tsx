// The analytics screen's colours with Reduced Colors applied
// (packages/reduced-colors). One answer for the whole screen, handed down by
// ChartColorsScope, so a project's chip, its segments and its legend entry
// can never disagree. Off, a project wears the colour set on it and the
// rest of the screen palette.ts's.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSeriesPainting, type SeriesPainting } from "@bb-plugins/reduced-colors";

import { TASK_TYPES, type TaskStatus, type TaskType } from "../../db/types.js";
import type { ReducedProjects } from "../../shared/reduced-projects.js";
import { seriesColor } from "./closed-model";
import { OVERFLOW_COLOR, STATUS_COLOR, TYPE_COLOR } from "./palette";

/** What the screen paints projects from: the board's projects with their own colours, and what Reduced Colors does to them. */
export interface ChartBoard {
  /** In board order — the order of their ramp steps. */
  readonly projects: readonly { readonly id: string; readonly color: string }[];
  readonly reducedProjects: ReducedProjects;
}

export interface ChartColors {
  /** A project by its id; one the board no longer lists is muted. */
  readonly project: (id: string) => string;
  /** A series of any other field, by its place in the legend. */
  readonly byPlace: (index: number) => string;
  readonly status: (status: TaskStatus) => string;
  readonly type: (type: TaskType | "untyped") => string;
  /** The two sides of «Created vs closed». */
  readonly createdClosed: { readonly created: string; readonly closed: string };
}

/**
 * The statuses that go on the ramp, in the order work moves through them.
 * Canceled is not among them: its red is an alarm and stays red
 * (docs/decisions/reduced-colors-alarm-red-stays.md).
 */
const RAMP_STATUSES: readonly TaskStatus[] = ["backlog", "todo", "in_progress", "in_review", "done"];

/** A colour by the key's place in `keys` on the ramp, else the key's own colour. */
const onRamp =
  <K,>(keys: readonly K[], steps: readonly string[], own: (key: K) => string) =>
  (key: K): string =>
    steps[keys.indexOf(key)] ?? own(key);

/** A colour by the key's place in `keys` among `steps`, muted past them. */
const byIndexIn =
  <K,>(keys: readonly K[], steps: readonly string[]) =>
  (key: K): string =>
    steps[keys.indexOf(key)] ?? OVERFLOW_COLOR;

/**
 * The screen's colours for `board`. Off, a project wears the colour set on
 * it. While Reduced Colors is on, every project of the board gets its ramp
 * step — none is muted past the eighth — unless the owner keeps the
 * projects' own colours; statuses and types join the ramp, canceled and
 * untyped keep theirs. A project the board no longer lists is muted.
 */
export function chartColors(painting: SeriesPainting, board: ChartBoard): ChartColors {
  const ids = board.projects.map((project) => project.id);
  const own = byIndexIn(ids, board.projects.map((project) => project.color));
  switch (painting.kind) {
    case "palette":
      return {
        project: own,
        byPlace: seriesColor,
        status: (status) => STATUS_COLOR[status],
        type: (type) => TYPE_COLOR[type],
        createdClosed: { created: "var(--muted-foreground)", closed: "var(--success)" },
      };
    case "ramp": {
      const projects = painting.steps(ids.length);
      const [created = OVERFLOW_COLOR, closed = OVERFLOW_COLOR] = painting.steps(2);
      return {
        project: board.reducedProjects === "own" ? own : byIndexIn(ids, projects),
        byPlace: (index) => projects[index] ?? OVERFLOW_COLOR,
        status: onRamp(RAMP_STATUSES, painting.steps(RAMP_STATUSES.length), (status) => STATUS_COLOR[status]),
        type: onRamp<TaskType | "untyped">(TASK_TYPES, painting.steps(TASK_TYPES.length), (type) => TYPE_COLOR[type]),
        createdClosed: { created, closed },
      };
    }
  }
}

const NO_BOARD: ChartBoard = { projects: [], reducedProjects: "ramp" };

const ChartColorsContext = createContext<ChartColors>(chartColors({ kind: "palette" }, NO_BOARD));

/** Computes the screen's colours once per board, under whatever ReducedColorsProvider is above. */
export function ChartColorsScope({ board, children }: { board: ChartBoard; children: ReactNode }) {
  const painting = useSeriesPainting();
  const colors = useMemo(() => chartColors(painting, board), [painting, board]);
  return <ChartColorsContext.Provider value={colors}>{children}</ChartColorsContext.Provider>;
}

export function useChartColors(): ChartColors {
  return useContext(ChartColorsContext);
}

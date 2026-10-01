// The analytics screen's colours with Reduced Colors applied
// (packages/reduced-colors). One answer for the whole screen, handed down by
// ChartColorsScope, so a project's chip, its segments and its legend entry
// can never disagree. palette.ts stays the answer while the mode is off.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useSeriesPainting, type SeriesPainting } from "@bb-plugins/reduced-colors";

import { TASK_TYPES, type TaskStatus, type TaskType } from "../../db/types.js";
import { seriesColor } from "./closed-model";
import { OVERFLOW_COLOR, STATUS_COLOR, TYPE_COLOR } from "./palette";

export interface ChartColors {
  /** A project by its place on the board. */
  readonly project: (index: number) => string;
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

/**
 * The screen's colours for a board of `boardProjects` projects. While
 * Reduced Colors is on, every project of the board gets its step — none is
 * muted past the eighth — and a project the board no longer lists is drawn
 * muted; statuses and types join the ramp, canceled and untyped keep theirs.
 */
export function chartColors(painting: SeriesPainting, boardProjects: number): ChartColors {
  switch (painting.kind) {
    case "palette":
      return {
        project: seriesColor,
        status: (status) => STATUS_COLOR[status],
        type: (type) => TYPE_COLOR[type],
        createdClosed: { created: "var(--muted-foreground)", closed: "var(--success)" },
      };
    case "ramp": {
      const projects = painting.steps(boardProjects);
      const [created = OVERFLOW_COLOR, closed = OVERFLOW_COLOR] = painting.steps(2);
      return {
        project: (index) => projects[index] ?? OVERFLOW_COLOR,
        status: onRamp(RAMP_STATUSES, painting.steps(RAMP_STATUSES.length), (status) => STATUS_COLOR[status]),
        type: onRamp<TaskType | "untyped">(TASK_TYPES, painting.steps(TASK_TYPES.length), (type) => TYPE_COLOR[type]),
        createdClosed: { created, closed },
      };
    }
  }
}

const ChartColorsContext = createContext<ChartColors>(chartColors({ kind: "palette" }, 0));

/** Computes the screen's colours once, for the board's project count, under whatever ReducedColorsProvider is above. */
export function ChartColorsScope({ boardProjects, children }: { boardProjects: number; children: ReactNode }) {
  const painting = useSeriesPainting();
  const colors = useMemo(() => chartColors(painting, boardProjects), [painting, boardProjects]);
  return <ChartColorsContext.Provider value={colors}>{children}</ChartColorsContext.Provider>;
}

export function useChartColors(): ChartColors {
  return useContext(ChartColorsContext);
}

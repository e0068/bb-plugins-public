// Colours of the analytics charts. Constants, not CSS variables: bb builds the
// plugin's CSS itself and drops the plugin's own :root blocks, so a
// `--tp-series-*` declared in app.css never reaches the page. A project wears
// the colour set on it (chart-colors.ts); the categorical hues here paint the
// other fields' series by place and are Usage Analytics' palette; the status
// colours are bb's own theme tokens and follow light and dark.
import type { CSSProperties } from "react";

import type { TaskStatus, TaskType } from "../../db/types.js";
import { isEdgeless } from "../../lib/edgeless-color";

/** Categorical hues in fixed order for series painted by place — Usage Analytics' DEFAULT_PALETTE. */
export const PROJECT_PALETTE = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#eab308", "#14b8a6"] as const;

/** Past the last palette slot a series is drawn muted rather than with a cycled hue. */
export const OVERFLOW_COLOR = "var(--muted-foreground)";

/** A series mark's fill: its colour, plus a hairline in the theme's border colour where the colour alone would vanish. */
export function fillStyle(color: string): CSSProperties {
  return isEdgeless(color) ? { backgroundColor: color, boxShadow: "inset 0 0 0 1px var(--border)" } : { backgroundColor: color };
}

export const STATUS_COLOR: Readonly<Record<TaskStatus, string>> = {
  backlog: "var(--subtle-foreground)",
  todo: "var(--timeline-accent)",
  in_progress: "var(--attention)",
  in_review: "var(--pr-merged)",
  done: "var(--success)",
  canceled: "var(--destructive)",
};

export const STATUS_LABEL: Readonly<Record<TaskStatus, string>> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  canceled: "Canceled",
};

export const TYPE_COLOR: Readonly<Record<TaskType | "untyped", string>> = {
  epic: "#f97316",
  feature: "#3b82f6",
  bugfix: "#ef4444",
  spike: "#eab308",
  refactor: "#a855f7",
  migration: "#14b8a6",
  design: "#06b6d4",
  untyped: "var(--muted-foreground)",
};

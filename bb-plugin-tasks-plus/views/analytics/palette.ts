// Colours of the analytics charts. Constants, not CSS variables: bb builds the
// plugin's CSS itself and drops the plugin's own :root blocks, so a
// `--tp-series-*` declared in app.css never reaches the page. Categorical hues
// are Usage Analytics' palette, so both screens colour a project alike; the
// status colours are bb's own theme tokens and follow light and dark.
import type { TaskStatus, TaskType } from "../../db/types.js";

/** Categorical project hues in fixed order — Usage Analytics' DEFAULT_PALETTE. */
export const PROJECT_PALETTE = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#eab308", "#14b8a6"] as const;

/** Past the last palette slot a series is drawn muted rather than with a cycled hue. */
export const OVERFLOW_COLOR = "var(--muted-foreground)";

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

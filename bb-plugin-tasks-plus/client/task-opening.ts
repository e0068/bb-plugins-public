import { useCallback } from "react";
import {
  experimental_useAppPanel,
  type ExperimentalPluginFixedTabReference,
  type JsonValue,
} from "@get-bb/plugin-sdk/app";
import type { TaskOpening } from "../shared/enums.js";
import { useTasksNavigation } from "./routes.js";

export type TaskTabTarget = { taskKey: string };

const isTaskTabTarget = (value: JsonValue): value is TaskTabTarget =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  typeof value.taskKey === "string";

/** The thread side panel's Task tab — the `threadPanelAction` id that opens a task beside the chat. */
export const TASK_PANEL_ACTION = "task";

/** The Task tab of the Tasks+ page's right panel; its target is the task to show. */
export const TASK_TAB: ExperimentalPluginFixedTabReference<TaskTabTarget> = {
  panelId: "tasks",
  id: "task",
  experimental_target: { validate: isTaskTabTarget },
};

/**
 * Opens a task where the board or list chose to (its Display menu, stored
 * with the rest of its display config). The right panel can refuse — a
 * surface without one, a compact viewport — and then the task opens in the
 * main container, so a click never goes nowhere.
 */
export function useOpenTask(opening: TaskOpening): (taskKey: string) => void {
  const appPanel = experimental_useAppPanel();
  const navigation = useTasksNavigation();
  return useCallback(
    (taskKey: string) => {
      const openedBeside =
        opening === "side-panel" &&
        appPanel.openFixedTab({ surface: { kind: "current" }, tab: TASK_TAB, target: { taskKey } });
      if (!openedBeside) navigation.go({ kind: "task", taskKey });
    },
    [opening, appPanel, navigation],
  );
}

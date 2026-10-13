import { definePluginApp, useSettings } from "@get-bb/plugin-sdk/app";
import { registerRailCollapse, registerSelectedThread } from "@bb-plugins/rail-collapse";
import { ReducedColorsSection } from "@bb-plugins/reduced-colors";
import { useTasksRpc } from "./shell/data.js";
import { TasksAppShell } from "./shell/app-shell.js";
import { TasksSidebarAccessory } from "./shell/sidebar-accessory.js";
import { BusyThreadsReporter } from "./shell/busy-threads-reporter.js";
import { SidebarRowIcons } from "./shell/sidebar-row-icon.js";
import { BoardColumnWidthSetting } from "./shell/board-column-width-setting.js";
import { ReducedProjectsSetting } from "./shell/reduced-projects-setting.js";
import { TaskDirectiveCard, TaskEmbedPanel, TaskSidePanelTab } from "./views/embed/index.js";
import { TASK_PANEL_ACTION, TASK_TAB } from "./client/task-opening.js";
import { CurrentTaskHeaderAction } from "./views/header/current-task.js";
import { TASKS_PLUGIN_ID } from "./shared/plugin-id.js";

/** The settings page's Reduced Colors block for the analytics charts — bb's declared settings have no colour field — and whether it repaints the projects. */
function ReducedColorsSettings() {
  const rpc = useTasksRpc();
  return (
    <>
      <ReducedColorsSection load={() => rpc.call("loadReducedColors", {})} save={(value) => rpc.call("saveReducedColors", value)} />
      <ReducedProjectsSetting />
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "tasks",
    title: "Tasks+",
    icon: "ListTodo",
    path: "tasks",
    component: TasksAppShell,
    experimental_sidebarAccessory: TasksSidebarAccessory,
    fixedTabs: [{ ...TASK_TAB, title: "Task", icon: "ListTodo", component: TaskSidePanelTab, layout: "padded" }],
  });
  // A click on the Tasks+ icon in the left rail collapses the threads panel when the owner turned it on.
  registerRailCollapse(app, TASKS_PLUGIN_ID, useSettings);
  // Tasks+ opened from a thread shows that thread's task when the owner turned it on.
  registerSelectedThread(app, TASKS_PLUGIN_ID, useSettings);
  app.slots.threadPanelAction({
    id: TASK_PANEL_ACTION,
    title: "Task",
    icon: "ListTodo",
    component: TaskEmbedPanel,
  });
  app.slots.experimental_threadHeaderAction({
    id: "current-task",
    title: "Task",
    component: CurrentTaskHeaderAction,
  });
  app.slots.messageDirective({ id: "task", component: TaskDirectiveCard });
  // A thread waiting for its own workflow counts as working in Active and on the cards.
  app.slots.experimental_appOverlay({ id: "busy-threads", component: BusyThreadsReporter });
  // A board's icon in the row of its bb project in bb's thread list, and the picker it opens.
  app.slots.experimental_appOverlay({ id: "sidebar-project-icons", component: SidebarRowIcons });
  app.slots.settingsSection({
    id: "reduced-colors",
    title: "Reduced Colors",
    description: "Analytics charts use a gradient of two colours instead of the palette.",
    component: ReducedColorsSettings,
  });
  app.slots.settingsSection({
    id: "board-columns",
    title: "Board columns",
    description: "The narrowest and widest a board column may be, and how wide it starts.",
    component: BoardColumnWidthSetting,
  });
});

import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ReducedColorsSection } from "@bb-plugins/reduced-colors";
import { useTasksRpc } from "./shell/data.js";
import { TasksAppShell } from "./shell/app-shell.js";
import { TasksSidebarAccessory } from "./shell/sidebar-accessory.js";
import { BoardColumnWidthSetting } from "./shell/board-column-width-setting.js";
import { ReducedProjectsSetting } from "./shell/reduced-projects-setting.js";
import { TaskDirectiveCard, TaskEmbedPanel, TaskSidePanelTab } from "./views/embed/index.js";
import { TASK_TAB } from "./client/task-opening.js";
import { CurrentTaskHeaderAction } from "./views/header/current-task.js";

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
  app.slots.threadPanelAction({
    id: "task",
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

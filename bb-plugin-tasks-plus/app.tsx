import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { TasksAppShell } from "./shell/app-shell.js";
import { TasksSidebarAccessory } from "./shell/sidebar-accessory.js";
import { TaskDirectiveCard, TaskEmbedPanel } from "./views/embed/index.js";
import { CurrentTaskHeaderAction } from "./views/header/current-task.js";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "tasks",
    title: "Tasks+",
    icon: "ListTodo",
    path: "tasks",
    component: TasksAppShell,
    experimental_sidebarAccessory: TasksSidebarAccessory,
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
});

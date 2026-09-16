import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import {
  useActiveTasks,
  useFolders,
  usePresets,
  useProjects,
  useSidebarSummary,
  useWaitingTasks,
} from "../client/data.js";
import { TasksRefreshProvider } from "../client/refresh.js";
import { parseTasksRoute, useTasksNavigation } from "../client/routes.js";
import { TasksSidebar } from "./sidebar.js";
import { NewProjectDialog } from "../views/manage/index.js";
import { useState } from "react";

export function TasksNavigationPanelContent({ subPath }: PluginNavPanelProps) {
  const route = parseTasksRoute(subPath);
  const navigation = useTasksNavigation();
  const folders = useFolders();
  const projects = useProjects();
  const summaries = useSidebarSummary();
  const presets = usePresets();
  const activeTasks = useActiveTasks();
  const waitingTasks = useWaitingTasks();
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  return (
    <>
      <TasksSidebar
        route={route}
        folders={folders.data}
        projects={projects.data}
        summaries={summaries.data}
        presets={presets.data}
        activeTasks={activeTasks.data}
        waitingTasks={waitingTasks.data}
        pendingSidebarData={[
          ...(projects.isLoading ? (["projects"] as const) : []),
          ...(summaries.isLoading ? (["summary"] as const) : []),
        ]}
        onNavigate={navigation.go}
        onNewProject={() => setNewProjectOpen(true)}
      />
      {newProjectOpen ? (
        <NewProjectDialog open onOpenChange={setNewProjectOpen} />
      ) : null}
    </>
  );
}

export function TasksNavigationPanel(props: PluginNavPanelProps) {
  return (
    <TasksRefreshProvider>
      <TasksNavigationPanelContent {...props} />
    </TasksRefreshProvider>
  );
}

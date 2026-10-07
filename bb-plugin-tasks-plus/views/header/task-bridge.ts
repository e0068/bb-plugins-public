import { useEffect } from "react";
import { useBbNavigate, useRealtime } from "@get-bb/plugin-sdk/app";
import { announceTasksChanged, onOpenTask } from "@bb-plugins/task-bridge";
import { TASK_PANEL_ACTION } from "../../client/task-opening.js";

/**
 * Мост задач для других плагинов треда (packages/task-bridge): Flow не может
 * открыть чужую вкладку и не слышит чужих событий. Живёт в кнопке шапки,
 * потому что она смонтирована в каждом треде, даже когда ничего не рисует.
 * Просьбу берёт только для своего треда: в раздвоенном окне у каждого
 * треда своя шапка и своя панель.
 */
export function useTaskBridge(threadId: string): void {
  const navigate = useBbNavigate();
  useEffect(
    () =>
      onOpenTask(
        window,
        (request) =>
          request.threadId === threadId &&
          navigate.openThreadPanel({ actionId: TASK_PANEL_ACTION, title: request.taskKey, params: { taskKey: request.taskKey } }),
      ),
    [navigate, threadId],
  );
  useRealtime("tasks:changed", () => announceTasksChanged(window));
}

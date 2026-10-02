// What the value suggestions of a tile's filter read: every board's tasks,
// projects and labels — fetched only while a row could use them.
import { listAllTasks, useTasksQuery, type TasksRpc } from "../../client/data";
import type { SuggestionScope } from "../../shared/tile-conditions.js";

async function fetchScope(rpc: TasksRpc): Promise<SuggestionScope> {
  const [tasks, { projects }] = await Promise.all([listAllTasks(rpc, {}), rpc.call("listProjects", {})]);
  const labels = await Promise.all(projects.map((project) => rpc.call("listLabels", { projectId: project.id }).then((result) => result.labels, () => [])));
  return { tasks, projects, labels: labels.flat() };
}

/** The boards' tasks, projects and labels while `wanted`; undefined before they load and while not wanted. */
export function useSuggestionScope(wanted: boolean): SuggestionScope | undefined {
  const query = useTasksQuery(async (rpc) => (wanted ? fetchScope(rpc) : null), ["tasks:changed", "projects:changed"], [wanted]);
  return query.data ?? undefined;
}

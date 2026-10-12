// Адрес раздела Workflows на странице Flow — хвост панели `workflows`, `workflows/<имя>` или `workflows/+new`. Чистые функции:
// страница, шапка и список flow читают по ним, раздел ли это и что в нём открыто.

export const WORKFLOWS_SUB_PATH = "workflows";
const NEW = "+new";

export type WorkflowsPlace = { kind: "list" } | { kind: "open"; name: string } | { kind: "new" };

/** Что открыто в разделе Workflows; `null` — адрес не раздела. */
export const workflowsPlace = (subPath: string): WorkflowsPlace | null => {
  if (subPath === WORKFLOWS_SUB_PATH) return { kind: "list" };
  if (!subPath.startsWith(`${WORKFLOWS_SUB_PATH}/`)) return null;
  const tail = subPath.slice(WORKFLOWS_SUB_PATH.length + 1);
  if (tail === NEW) return { kind: "new" };
  return tail === "" || tail.includes("/") ? { kind: "list" } : { kind: "open", name: tail };
};

export const workflowsSubPath = (place: WorkflowsPlace): string =>
  place.kind === "list" ? WORKFLOWS_SUB_PATH : `${WORKFLOWS_SUB_PATH}/${place.kind === "new" ? NEW : place.name}`;

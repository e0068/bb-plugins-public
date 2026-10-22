// Слой 1 — чисто. Что шаг говорит владельцу, когда bb не отдал git-статус
// окружения треда.
//
// Причину называет сам bb: 21 октября его host-daemon 48 минут не мог
// запускать процессы (spawn EBADF), а шаги подменяли это своим текстом —
// «not a git repository» про папку с репозиторием и «(unavailable)» без
// причины вовсе.

/** Отказ bb: окружение без git — или git-статус, который bb не смог снять, с его кодом и сообщением. */
export type StatusRefusal =
  | { readonly outcome: "not_applicable"; readonly path: string }
  | { readonly outcome: "unavailable"; readonly failure: { readonly code: string; readonly message: string; readonly workspacePath: string } };

export function statusRefusalMessage(refusal: StatusRefusal): string {
  switch (refusal.outcome) {
    case "not_applicable":
      return `The thread's environment is not a git repository: ${refusal.path}. Point the project at the folder that holds the repository, then retry.`;
    case "unavailable": {
      const { code, message, workspacePath } = refusal.failure;
      return `Git status of the thread's environment is unavailable (${workspacePath}, ${code}): ${message}`;
    }
  }
}

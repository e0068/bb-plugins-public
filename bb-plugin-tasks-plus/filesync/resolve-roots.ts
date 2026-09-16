import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { join } from "node:path";
import type { BoardRoot } from "./fs-boards.js";
import type { CallerEnvironment } from "./caller-root.js";

type ProjectSource = Awaited<
  ReturnType<BbPluginApi["sdk"]["projects"]["get"]>
>["sources"][number];

/** The checkout a bb project calls home: its default source, else the first. */
export function defaultSourcePath(
  sources: readonly ProjectSource[],
): string | null {
  const source = sources.find((entry) => entry.isDefault) ?? sources[0];
  return source?.path ?? null;
}

/**
 * Resolves the board's main checkout root. This barely ever changes once a
 * board is connected (only a `bb sources` edit on the underlying project
 * moves it), so a caller resolves it once at connect time and does not
 * repeat this call on every roots refresh — unlike the worktree list, it
 * is not the thing that goes stale (see
 * decisions/tasks-plus-board-roots-blocks-rpc.md). Never throws: an
 * unreachable project or one without sources simply has no main root.
 */
export async function resolveMainRoot(
  bb: BbPluginApi,
  bbProjectId: string,
  tasksFolder: string,
): Promise<BoardRoot | null> {
  try {
    const project = await bb.sdk.projects.get({ projectId: bbProjectId });
    const mainPath = defaultSourcePath(project.sources);
    return mainPath ? { absPath: join(mainPath, tasksFolder), origin: { kind: "main" } } : null;
  } catch {
    return null;
  }
}

/**
 * Резолвит окружение вызывающего треда — одно, по известному id. Одно
 * обращение к хосту вместо обхода списка живых деревьев: адрес известен
 * заранее, поэтому нагрузка не зависит ни от числа деревьев, ни от того,
 * как часто их заводят (decisions/tasks-plus-board-roots-blocks-rpc.md).
 * Не бросает: недоступное окружение означает «своего дерева нет», и команда
 * работает с main.
 */
export async function resolveCallerEnvironment(
  bb: BbPluginApi,
  environmentId: string | null,
): Promise<CallerEnvironment | null> {
  if (!environmentId) return null;
  try {
    const environment = await bb.sdk.environments.get({ environmentId });
    return {
      environmentId,
      projectId: environment.projectId,
      path: environment.path,
      name: environment.name,
      branchName: environment.branchName,
      isWorktree: environment.isWorktree,
      hostId: environment.hostId,
    };
  } catch (error) {
    // Мягко, но вслух: команда работает с main, а не падает, — и в логе
    // видно, почему тред не увидел своего дерева. Немой откат в main и был
    // тем, из-за чего дефект BBPL-293 прожил незамеченным.
    bb.log.warn(
      `tasks-plus: не удалось разрешить окружение ${environmentId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

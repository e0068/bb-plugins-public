// Файл workflow и то, что конструктору нужно о нём знать: какой .js открывать конструктором и для какого движка он
// собран, и какие агенты каталога годятся шаблоном шага. Чистые функции: путь и каталог приходят снаружи.
import type { AgentOption } from "@bb-plugins/workflow-builder/agents";

import type { StageExecutor } from "../shared/contract";

/** Движок файла workflow: `~/.claude/workflows` — Claude Code, `.bb/workflows` проекта — bb. */
export type WorkflowEngine = "claude" | "bb";

/**
 * Для какого движка собран .js по его абсолютному пути; не файл workflow — `null`. Workflow — только верхний уровень своей
 * папки: так их читают оба движка, а подпапки и соседние файлы (тесты, заметки) остаются обычными файлами.
 */
export const workflowFileEngine = (path: string): WorkflowEngine | null => {
  if (!path.startsWith("/") || path.split("/").includes("..")) return null;
  const match = /\/\.(claude|bb)\/workflows\/[^/]+\.js$/.exec(path);
  return match === null ? null : match[1] === "claude" ? "claude" : "bb";
};

/** Агент шаблоном шага — тот же AgentOption, что берёт конструктор. */
export type WorkflowAgentOption = AgentOption;

const SCOPE = { own: "user", project: "project", plugin: "plugin" } as const;

/** Агенты Claude Code из каталога исполнителей: тип агента — id без `agent:`; workflow и агенты Codex шаблоном не бывают. */
export const workflowAgentOptions = (entries: ReadonlyArray<{ executor: StageExecutor; path: string }>): WorkflowAgentOption[] =>
  entries.flatMap(({ executor, path }) =>
    executor.kind !== "agent" || executor.id.startsWith("agent:codex/")
      ? []
      : [
          {
            value: executor.id.slice("agent:".length),
            model: executor.model ?? "",
            effort: "",
            provider: executor.provider ?? "",
            ...(executor.description === undefined ? {} : { description: executor.description }),
            path,
            ...(executor.origin === undefined ? {} : { scope: SCOPE[executor.origin.kind] }),
          },
        ],
  );

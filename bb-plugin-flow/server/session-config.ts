// Настройка сессии агента: перед стартом каждой сессии bb спрашивает плагин, какие его инструменты и навыки дать агенту.
// Flow отдаёт все свои — выбор ему нужен как единственная точка, где путь к дереву треда уже есть, а Claude Code ещё не
// запущен: здесь синхронно ложится отложенный файл ограничения навыков (./skill-scope.ts). Сбой записи сессию не трогает:
// упавший выбор отнял бы у агента все инструменты Flow. Сессия Side chat не получает ничего: Flow её не ведёт, а дерево у
// неё общее с основным тредом, и ограничение навыков в нём — основного.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { isSideChat } from "../core/side-chat";
import { BUILTIN_SKILLS, FLOW_CREATE_SKILL, ROOT_SKILL } from "../lib/stage-constants";

/** Навыки, которые Flow везёт в `skills/`, — по имени из шапки SKILL.md. */
export const FLOW_SKILLS: readonly string[] = [ROOT_SKILL, ...Object.values(BUILTIN_SKILLS), FLOW_CREATE_SKILL];

export const registerSessionConfig = (
  bb: Pick<BbPluginApi, "agents">,
  deps: {
    /** Все инструменты агента, которые Flow регистрирует. */
    tools: readonly string[];
    /** Кладёт отложенное решение в дерево треда; `null` — дерева нет, решение забывается. */
    prestart: (threadId: string, root: string | null) => void;
    warn: (message: string) => void;
  },
): void => {
  bb.agents.configure(({ thread, environment, origin }) => {
    if (isSideChat({ originPluginId: origin.pluginId })) return { tools: [], skills: [] };
    const root = environment.workspaceProvisionType === "managed-worktree" ? environment.path : null;
    try {
      deps.prestart(thread.id, root);
    } catch (error) {
      deps.warn(`skill scope: thread ${thread.id} not written before the session (${error instanceof Error ? error.message : String(error)})`);
    }
    return { tools: [...deps.tools], skills: [...FLOW_SKILLS] };
  });
};

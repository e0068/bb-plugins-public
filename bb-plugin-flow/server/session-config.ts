// Настройка сессии агента: перед стартом каждой сессии bb спрашивает плагин, какие его инструменты и навыки дать агенту.
// Flow отдаёт все свои — выбор ему нужен как единственная точка, где путь к дереву треда уже есть, а Claude Code ещё не
// запущен: здесь синхронно ложится отложенный файл ограничения навыков (./skill-scope.ts). Сбой записи сессию не трогает:
// упавший выбор отнял бы у агента все инструменты Flow. Сессия Side chat не получает ничего: Flow её не ведёт, а дерево у
// неё общее с основным тредом, и ограничение навыков в нём — основного. Стартовое сообщение flow треда сессия получает
// невидимой инструкцией только на старте: новый тред с «Автоматически» получает flow до старта сессии (./auto-choice.ts),
// и сообщение выбранного flow приходит тем же путём, а живая сессия, выбравшая flow после завершённого прогона, его не получает.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { isSideChat } from "../core/side-chat";
import { BUILTIN_SKILLS, FLOW_CREATE_SKILL, ROOT_SKILL, WORKFLOW_BUILDER_SKILL } from "../lib/stage-constants";

/** Навыки, которые Flow везёт в `skills/` для агентов, — по имени из шапки SKILL.md; навык выбора flow читает только модель выбора. */
export const FLOW_SKILLS: readonly string[] = [ROOT_SKILL, ...Object.values(BUILTIN_SKILLS), FLOW_CREATE_SKILL, WORKFLOW_BUILDER_SKILL];

export const registerSessionConfig = (
  bb: Pick<BbPluginApi, "agents">,
  deps: {
    /** Все инструменты агента, которые Flow регистрирует. */
    tools: readonly string[];
    /** Кладёт отложенное решение в дерево треда; `null` — дерева нет, решение забывается. */
    prestart: (threadId: string, root: string | null) => void;
    /** Стартовое сообщение flow треда — невидимая инструкция сессии; `null` — нет. Не задано — нет. */
    startMessage?: (threadId: string) => string | null;
    warn: (message: string) => void;
    deliver?: (threadId: string, root: string | null) => string | undefined;
  },
): void => {
  bb.agents.configure(({ thread, environment, origin, provider }) => {
    if (isSideChat({ originPluginId: origin.pluginId })) return { tools: [], skills: [] };
    const root = environment.workspaceProvisionType === "managed-worktree" ? environment.path : null;
    try {
      deps.prestart(thread.id, root);
    } catch (error) {
      deps.warn(`skill scope: thread ${thread.id} not written before the session (${error instanceof Error ? error.message : String(error)})`);
    }
    // Инструкции сессии: доставка навыков провайдерам без своих навыков (первой — она нужна, чтобы навыки работали) и стартовое
    // сообщение flow треда; вместе не длиннее 4096 символов — лишнее обрежет bb.
    const delivered = provider.id === "claude-code" ? undefined : deps.deliver?.(thread.id, root);
    const start = deps.startMessage?.(thread.id) ?? null;
    const instructions = [delivered, start].filter((part): part is string => part !== undefined && part !== null && part !== "").join("\n\n");
    return { tools: [...deps.tools], skills: [...FLOW_SKILLS], ...(instructions === "" ? {} : { instructions }) };
  });
};

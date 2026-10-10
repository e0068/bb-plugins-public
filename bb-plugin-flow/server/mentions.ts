// Список полей Flow по `/` и `@`. Тред есть — bb отдаёт то же, что композеру этого треда: команды и навыки его агента и
// файлы его рабочей копии; треда нет — навыки каталога Flow. Сужение по набранному — в ядре (../core/mentions.ts).
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { rankByName } from "../core/mentions";
import { mentionsRpcContract, type MentionItem, type StageCatalog } from "../shared/contract";

/** Файлов не больше: дальше владелец сужает набором. */
const LIMIT = 30;

/** Навыков и команд — весь список: поле берёт его раз на слово и сужает само с каждой буквой. */
const ALL = 1000;

const optional = (description: string | null | undefined) => (description ? { description } : {});

/** Рабочая копия треда для bb; без неё bb берёт папку проекта. */
const routingOf = (environmentId: string | null): { environmentId: string } | { environmentId?: never } => (environmentId === null ? {} : { environmentId });

/** Навыки и команды агента треда — у bb они общие с композером. */
const threadCommands = async (sdk: BbPluginApi["sdk"], threadId: string, query: string): Promise<MentionItem[]> => {
  const thread = await sdk.threads.get({ threadId });
  const { commands } = await sdk.projects.commands({
    projectId: thread.projectId,
    ...routingOf(thread.environmentId),
    provider: thread.providerId,
  });
  return rankByName(commands, query, ALL).map((c) => ({ kind: c.source === "skill" ? "skill" : "command", name: c.name, insert: c.name, ...optional(c.description) }));
};

/** Файлы и папки рабочей копии треда; ранжирует их сам bb. */
const threadPaths = async (sdk: BbPluginApi["sdk"], threadId: string, query: string): Promise<MentionItem[]> => {
  const thread = await sdk.threads.get({ threadId });
  const { paths } = await sdk.projects.paths({
    projectId: thread.projectId,
    ...routingOf(thread.environmentId),
    query,
    includeFiles: "true",
    includeDirectories: "true",
    limit: String(LIMIT),
  });
  return paths.map((p) => ({ kind: p.kind, name: p.name, insert: p.path, description: p.path }));
};

const catalogSkills = (catalog: StageCatalog, query: string): MentionItem[] =>
  rankByName(catalog.skills, query, ALL).map((s) => ({ kind: "skill", name: s.name, insert: s.name, ...optional(s.description) }));

const IN_THREAD = { "/": threadCommands, "@": threadPaths } as const;

export const registerMentionsApi = (bb: Pick<BbPluginApi, "rpc" | "sdk">, deps: { catalog: () => Promise<StageCatalog> }): void => {
  // Вне треда рабочей копии нет: `@` ничего не находит.
  const OUTSIDE = { "/": (query: string) => deps.catalog().then((catalog) => catalogSkills(catalog, query)), "@": async () => [] } as const;
  bb.rpc.register(mentionsRpcContract, {
    async mentions({ threadId, trigger, query }) {
      const items = threadId === undefined ? OUTSIDE[trigger](query) : IN_THREAD[trigger](bb.sdk, threadId, query);
      return items.then(
        (found) => ({ kind: "found" as const, items: found }),
        () => ({ kind: "unavailable" as const }),
      );
    },
  });
};

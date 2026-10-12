// RPC страницы виджета: файл состава виджета — абсолютный путь на хосте для просмотрщика bb. Фронт не читает папку установки
// плагина, а одноимённый навык владельца важнее плагинового, поэтому корень плагина сервер берёт у навыка именно этого
// плагина. Отдаются только файлы состава (`core/widget-anatomy.ts`): вызов не читает ничего вне него.
import { join } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { OWN_PLUGIN_ID } from "../core/plugin-id";
import { allowedWidgetFiles, pluginRootOf } from "../core/widget-anatomy";
import { skillFileSchema, type SkillFile } from "../shared/contract";
import type { SkillFileSources } from "./stage-catalog";

export const widgetFilesRpcContract = defineRpcContract({
  /** Файл состава виджета по пути от корня плагина; нет в составе, нет на диске или хост не найден — `null`. */
  getWidgetFile: { input: z.object({ path: z.string() }), output: skillFileSchema },
});

/** Источники файла навыка и проверка, что файл лежит на диске: из установки без исходников файлов кода нет. */
export type WidgetFileSources = SkillFileSources & { exists: (path: string) => Promise<boolean> };

/** Корень этого плагина — по первому его навыку из списков навыков проектов bb. */
const pluginRoot = async (sources: SkillFileSources): Promise<string | null> => {
  const lists = await Promise.all((await sources.projectIds()).map((id) => sources.skills(id)));
  return lists.flat().filter((skill) => skill.pluginId === OWN_PLUGIN_ID).map((skill) => pluginRootOf(skill.filePath, skill.name)).find((root) => root !== null) ?? null;
};

/** Файл виджета по пути от корня плагина; любой сбой источника — `null`: страница тогда пишет «файла нет». */
export const readWidgetFile = async (sources: WidgetFileSources, path: string): Promise<SkillFile> => {
  if (!allowedWidgetFiles().has(path)) return null;
  try {
    const [root, hostId] = await Promise.all([pluginRoot(sources), sources.primaryHostId()]);
    if (root === null || hostId === null) return null;
    const file = join(root, path);
    return (await sources.exists(file)) ? { hostId, path: file } : null;
  } catch {
    return null;
  }
};

export const registerWidgetFiles = (bb: Pick<BbPluginApi, "rpc">, sources: WidgetFileSources): void => {
  bb.rpc.register(widgetFilesRpcContract, { getWidgetFile: ({ path }) => readWidgetFile(sources, path) });
};

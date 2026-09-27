// Корни файлов треда для тестов виджета: окружение и хранилище, которые сервер
// отдаёт вызовом threadFiles. Без них ссылка результата остаётся подписью.
import type { PluginRpcHandlers } from "@get-bb/plugin-sdk/app";

import type { filesRpcContract } from "../shared/contract";

export const ENVIRONMENT = "env_1";
export const STORAGE = "/Users/me/.bb/thread-storage/thr_1";

export const threadFiles: PluginRpcHandlers<typeof filesRpcContract>["threadFiles"] = () => ({ environmentId: ENVIRONMENT, storage: { hostId: "local", storageRootPath: STORAGE } });

/** Превью файла дерева треда — вызов навигации, который делает ссылка bb по клику. */
export const workspacePreview = (path: string) => ({ method: "experimental_openFilePreview", options: { target: { kind: "workspace", environmentId: ENVIRONMENT, path }, location: null } });

// Window Chrome, сервер: хранит значения темы окна и пишет их файлом темы bb.
// Значения общие для всех окон — фронт читает их по RPC и перечитывает по сигналу.
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { parseThemeValues, THEME_CHANGED, themeCss, themeId, type ThemeValues } from "./core/theme";
import { themeRpcContract, type SaveResult } from "./shared/contract";

/** Ключ хранилища со значениями темы. */
const THEME_KEY = "theme";

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

const outcome = (status: SaveResult["status"], id: string | null, message: string | null = null): SaveResult => ({ status, id, message });

export default function plugin(bb: BbPluginApi): void {
  const read = async (): Promise<ThemeValues> => parseThemeValues(await bb.storage.kv.get(THEME_KEY));

  bb.rpc.register(themeRpcContract, {
    get: () => read(),
    async set(values) {
      await bb.storage.kv.set(THEME_KEY, values);
      bb.realtime.publish(THEME_CHANGED, {});
      return { ok: true as const };
    },
    // Тема bb — папка `<dir>/<id>` с файлом theme.css; bb находит её по id.
    async saveTheme({ name, replace }) {
      const id = themeId(name);
      if (id === null) return outcome("invalid_name", null);
      const folder = join((await bb.sdk.theme.catalog()).dir, id);
      const file = join(folder, "theme.css");
      if (!replace && (await exists(file))) return outcome("exists", id);
      try {
        await mkdir(folder, { recursive: true });
        await writeFile(file, `${themeCss(await read(), "file")}\n`);
      } catch (error) {
        return outcome("write_failed", id, error instanceof Error ? error.message : String(error));
      }
      await bb.sdk.theme.set(id);
      return outcome("saved", id);
    },
  });
}

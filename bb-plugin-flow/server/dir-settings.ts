// Путь журнала решений по проекту, в kv плагина: одна запись — словарь
// «projectId — путь». Оболочка над kv; проверка пути — чистая функция.
import type { PluginKvStorage } from "@get-bb/plugin-sdk";

import { journalDirsSchema } from "../shared/contract";

const KEY = "settings:journal-dirs";

export type JournalDirResult = { kind: "configured"; path: string } | { kind: "not_configured" };
export type SetJournalDirResult = { kind: "saved"; path: string | null } | { kind: "invalid"; reason: "absolute" | "traversal" };

type Normalized = { kind: "cleared" } | { kind: "invalid"; reason: "absolute" | "traversal" } | { kind: "valid"; path: string };

/** Относительный путь без ведущего `/` и без выхода наверх; пусто — «снять настройку». */
export const normalizeJournalDir = (raw: string): Normalized => {
  const trimmed = raw.trim().replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (trimmed === "") return { kind: "cleared" };
  if (trimmed.startsWith("/")) return { kind: "invalid", reason: "absolute" };
  if (trimmed.split("/").includes("..")) return { kind: "invalid", reason: "traversal" };
  return { kind: "valid", path: trimmed };
};

export type JournalDirStore = {
  get(projectId: string): Promise<JournalDirResult>;
  set(projectId: string, path: string): Promise<SetJournalDirResult>;
  list(): Promise<Record<string, string>>;
};

const readMap = async (kv: PluginKvStorage): Promise<Record<string, string>> => {
  const parsed = journalDirsSchema.safeParse(await kv.get(KEY));
  return parsed.success ? parsed.data : {};
};

export const createJournalDirStore = (kv: PluginKvStorage): JournalDirStore => ({
  async get(projectId) {
    const path = (await readMap(kv))[projectId];
    return path === undefined ? { kind: "not_configured" } : { kind: "configured", path };
  },
  async set(projectId, raw) {
    const normalized = normalizeJournalDir(raw);
    if (normalized.kind === "invalid") return normalized;
    const map = await readMap(kv);
    const next = { ...map };
    if (normalized.kind === "cleared") delete next[projectId];
    else next[projectId] = normalized.path;
    await kv.set(KEY, next);
    return { kind: "saved", path: normalized.kind === "cleared" ? null : normalized.path };
  },
  list: () => readMap(kv),
});

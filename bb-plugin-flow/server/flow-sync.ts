// Синхронизация коллекции flow с папкой на диске, которую возит Syncthing.
// kv остаётся рабочей копией: инструкции агенту читают её синхронно. Каждое
// сохранение переписывает папку; опрос раз в несколько секунд сверяет файлы
// папки с последними своими и при отличии собирает из них коллекцию. Папка,
// которая не собралась — недоехала, битая, не та схема, — локальные flow не
// трогает: ошибка видна на странице, а следующая правка файлов даёт новую
// попытку. Раскладка файлов — ../core/flow-files.
import { mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { BbPluginApi, PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { FLOW_FILE_SUFFIX, fromFlowFiles, planWrite, SETTINGS_FILE, toFlowFiles, withLocalFlows, type CollectionFile, type FolderFlow } from "../core/flow-files";
import { collectionFileSchema, flowFileSchema, flowSettingsSchema, flowSyncRpcContract, type FlowSettings, type FlowSyncState, type FlowSyncStatus } from "../shared/contract";
import type { FlowSettingsStore } from "./flow-settings";

/** Папка `~/.claude` у владельца уже в Syncthing — flow едут вместе с навыками и агентами. */
export const DEFAULT_SYNC_DIR = "~/.claude/BB Flows";
export const SYNC_POLL_MS = 2000;
export { FLOW_SYNC_CHANNEL } from "../lib/channels";

const DIR_KEY = "settings:sync-dir";

/** Что поменялось для открытых вкладок: коллекция или итог сверки. */
export type SyncChange = "flows" | "sync";

export type FlowSync = {
  state(): FlowSyncState;
  setDir(dir: string): Promise<FlowSyncState>;
  /** Одна сверка папки с коллекцией; опрос зовёт её по таймеру. */
  tick(): Promise<void>;
  /** Конец записей, поставленных в очередь сохранениями. */
  idle(): Promise<void>;
};

/** Папка по умолчанию — переменная `BB_FLOW_SYNC_DIR` процесса bb, если задана (пустая — синхронизация выключена), иначе `~/.claude/BB Flows`. */
export const defaultSyncDir = (env: Readonly<Record<string, string | undefined>>): string => env.BB_FLOW_SYNC_DIR ?? DEFAULT_SYNC_DIR;

type Deps = {
  kv: PluginKvStorage;
  /** Папка, пока владелец не задал свою. */
  defaultDir?: string;
  flows: FlowSettingsStore;
  home: string;
  now: () => Date;
  published: (change: SyncChange) => void;
};

const resolveDir = (dir: string, home: string): string => (dir === "~" ? home : dir.startsWith("~/") ? join(home, dir.slice(2)) : dir);

/** Служебное Syncthing и чужие временные файлы — скрытые; копии конфликтов — с меткой в имени. */
const ignored = (name: string): boolean => name.startsWith(".") || name.includes(".sync-conflict-");

/** Файлы папки, которые Flow читает и пишет, — путь от корня и текст; папки нет — пусто. */
const readFolder = async (root: string): Promise<Map<string, string>> => {
  const walk = async (rel: string): Promise<Array<[string, string]>> => {
    const entries = await readdir(join(root, rel), { withFileTypes: true }).catch(() => []);
    const nested = await Promise.all(
      entries
        .filter((entry) => !ignored(entry.name))
        .map(async (entry): Promise<Array<[string, string]>> => {
          const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
          if (entry.isDirectory()) return walk(path);
          const ours = path === SETTINGS_FILE || entry.name.endsWith(FLOW_FILE_SUFFIX);
          return ours && entry.isFile() ? [[path, await readFile(join(root, path), "utf8")]] : [];
        }),
    );
    return nested.flat();
  };
  return new Map((await walk("")).sort(([a], [b]) => (a < b ? -1 : 1)));
};

const sameFiles = (a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean =>
  a.size === b.size && [...a].every(([path, text]) => b.get(path) === text);

type Parsed = { kind: "ok"; settings: FlowSettings } | { kind: "error"; message: string };

const parseJson = (path: string, text: string): { kind: "ok"; value: unknown } | { kind: "error"; message: string } => {
  try {
    return { kind: "ok", value: JSON.parse(text) };
  } catch {
    return { kind: "error", message: `${path}: not valid JSON` };
  }
};

const issueOf = (path: string, error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }): string => {
  const first = error.issues[0];
  return `${path}: ${first === undefined ? "invalid" : `${first.path.map(String).join(".") || "file"} — ${first.message}`}`;
};

/** Файлы папки → коллекция, прошедшая схему; первая же неудача — ошибкой с путём файла. */
const parseFolder = (files: ReadonlyMap<string, string>, local: FlowSettings): Parsed => {
  const flows: FolderFlow[] = [];
  let collection: CollectionFile | null = null;
  for (const [path, text] of files) {
    const json = parseJson(path, text);
    if (json.kind === "error") return json;
    if (path === SETTINGS_FILE) {
      const parsed = collectionFileSchema.safeParse(json.value);
      if (!parsed.success) return { kind: "error", message: issueOf(path, parsed.error) };
      collection = parsed.data;
    } else {
      const parsed = flowFileSchema.safeParse(json.value);
      if (!parsed.success) return { kind: "error", message: issueOf(path, parsed.error) };
      flows.push({ path, flow: parsed.data });
    }
  }
  const assembled = fromFlowFiles(flows, collection, local);
  if (assembled.kind === "error") return assembled;
  const valid = flowSettingsSchema.safeParse(assembled.settings);
  return valid.success ? { kind: "ok", settings: valid.data } : { kind: "error", message: issueOf("flows", valid.error) };
};

/** Запись без полуфайла: Syncthing на другой стороне увидит файл только целиком. Временный файл — скрытый, рядом и свой у каждого файла. */
const writeWhole = async (path: string, text: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  await writeFile(temp, text);
  await rename(temp, path);
};

/** Папки убранных файлов, опустевшие после уборки, — вверх до корня; чужие папки не трогаются. */
const removeEmptyParents = async (root: string, removed: readonly string[]): Promise<void> => {
  const parents = (path: string): string[] => (path.includes("/") ? [dirname(path), ...parents(dirname(path))] : []);
  const dirs = [...new Set(removed.flatMap(parents))].sort((a, b) => b.split("/").length - a.split("/").length);
  for (const rel of dirs) await rmdir(join(root, rel)).catch(() => undefined);
};

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Папка Flow — абсолютный путь или `~/…`, не сама домашняя папка и не корень диска: туда Flow пишет и оттуда убирает свои файлы. */
const validDir = (dir: string, home: string): boolean => {
  const resolved = resolveDir(dir, home);
  return isAbsolute(resolved) && resolve(resolved) !== resolve(home) && dirname(resolve(resolved)) !== resolve(resolved);
};

const INVALID_DIR = "The sync folder must be an absolute path or start with ~/, and must not be the home folder or the disk root";
const FOREIGN_SETTINGS = "settings.json in this folder is not a Flow file: choose an empty folder or a Flow sync folder";

/** `settings.json` есть, но не коллекция Flow: папка чужая, и Flow её не присваивает. */
const foreignSettings = (text: string | undefined): boolean => {
  if (text === undefined) return false;
  const json = parseJson(SETTINGS_FILE, text);
  return json.kind === "error" || !collectionFileSchema.safeParse(json.value).success;
};

const baseSchema = z.record(z.string(), z.string());
const baseKey = (dir: string) => `sync:base:${dir}`;

export const createFlowSync = async ({ kv, defaultDir = DEFAULT_SYNC_DIR, flows, home, now, published }: Deps): Promise<FlowSync> => {
  const stored = await kv.get(DIR_KEY);
  let dir = typeof stored === "string" ? stored : defaultDir;
  let status: FlowSyncStatus = dir === "" ? { kind: "off" } : { kind: "pending" };
  /** Файлы папки, уже разобранные последней сверкой: совпадение — разбирать снова нечего. */
  let seen: Map<string, string> | null = null;
  let queue: Promise<void> = Promise.resolve();
  const serial = (work: () => Promise<void>): Promise<void> => (queue = queue.then(work, work));

  const root = () => resolveDir(dir, home);
  const setStatus = (next: FlowSyncStatus) => {
    status = next;
    published("sync");
  };
  const at = () => now().toISOString();
  const fail = (error: unknown) => setStatus({ kind: "error", message: message(error), at: at() });

  /**
   * Последняя сверка — файлы папки, какими их последний раз записала или приняла эта машина; основа трёхсторонней записи.
   * Живёт в kv, чтобы перезапуск bb не превращал чужой, ещё не прочитанный файл в «лишний». Нет записи — первая встреча с папкой.
   */
  const loadBase = async (target: string): Promise<Map<string, string> | null> => {
    const parsed = baseSchema.safeParse(await kv.get(baseKey(target)));
    return parsed.success ? new Map(Object.entries(parsed.data)) : null;
  };
  const saveBase = (target: string, files: ReadonlyMap<string, string>) => kv.set(baseKey(target), Object.fromEntries(files));

  /** Коллекция — в папку против последней сверки. Чужие правки остаются на месте, и следующая сверка забирает их в коллекцию. */
  const write = async (target: string, settings: FlowSettings, base: ReadonlyMap<string, string>): Promise<void> => {
    const wanted = new Map(toFlowFiles(settings).map((f) => [f.path, f.text]));
    const plan = planWrite(wanted, await readFolder(target), base);
    // Старое имя, отличное от нового только регистром, убирается до записи: на нечувствительной к регистру системе это один файл.
    // Остальное — после записи, чтобы сбой записи не оставил папку без flow.
    const written = new Set(plan.writes.map(([path]) => path.toLowerCase()));
    const twins = plan.removes.filter((path) => written.has(path.toLowerCase()));
    const rest = plan.removes.filter((path) => !written.has(path.toLowerCase()));
    await Promise.all(twins.map((path) => rm(join(target, path), { force: true })));
    await Promise.all(plan.writes.map(([path, text]) => writeWhole(join(target, path), text)));
    await Promise.all(rest.map((path) => rm(join(target, path), { force: true })));
    await removeEmptyParents(target, plan.removes);
    await saveBase(target, wanted);
    seen = null;
    if (plan.kept.length === 0) setStatus({ kind: "synced", at: at() });
  };

  const exportSaved = (settings: FlowSettings) =>
    serial(async () => {
      if (dir === "") return;
      const target = root();
      // До первой встречи писать не во что: встреча сама сведёт папку с коллекцией, в которой уже есть это сохранение.
      const base = await loadBase(target);
      if (base !== null) await write(target, settings, base).catch(fail);
    });

  /** Коллекция из папки — в kv, папка — новая сверка; запись обратно в папку сделает слушатель сохранения, уже против неё. */
  const adopt = async (target: string, settings: FlowSettings, files: ReadonlyMap<string, string>): Promise<void> => {
    await flows.save(settings);
    await saveBase(target, files);
    published("flows");
  };

  const firstMeeting = async (target: string, files: ReadonlyMap<string, string>): Promise<void> => {
    if (foreignSettings(files.get(SETTINGS_FILE))) return setStatus({ kind: "error", message: FOREIGN_SETTINGS, at: at() });
    if (![...files.keys()].some((path) => path.endsWith(FLOW_FILE_SUFFIX))) return write(target, flows.current(), new Map());
    const parsed = parseFolder(files, flows.current());
    if (parsed.kind === "error") return setStatus({ kind: "error", message: parsed.message, at: at() });
    await adopt(target, withLocalFlows(parsed.settings, flows.current()), files);
  };

  const check = async (): Promise<void> => {
    if (dir === "") return;
    const target = root();
    const files = await readFolder(target);
    if (seen !== null && sameFiles(files, seen)) return;
    seen = files;
    const base = await loadBase(target);
    if (base === null) return firstMeeting(target, files);
    if (sameFiles(files, base)) return setStatus({ kind: "synced", at: at() });
    const parsed = parseFolder(files, flows.current());
    if (parsed.kind === "error") return setStatus({ kind: "error", message: parsed.message, at: at() });
    const current = new Map(toFlowFiles(flows.current()).map((f) => [f.path, f.text]));
    if (sameFiles(new Map(toFlowFiles(parsed.settings).map((f) => [f.path, f.text])), current)) {
      await saveBase(target, files);
      return setStatus({ kind: "synced", at: at() });
    }
    await adopt(target, parsed.settings, files);
  };

  // Импорт ставит запись папки в очередь за собой: сверка кончается, когда кончилась и она.
  const tick = async () => {
    await serial(() => check().catch(fail));
    await queue;
  };

  flows.onSaved((saved) => void exportSaved(saved));

  return {
    state: () => ({ dir, status }),
    async setDir(next) {
      const trimmed = next.trim();
      if (trimmed !== "" && !validDir(trimmed, home)) {
        setStatus({ kind: "error", message: INVALID_DIR, at: at() });
        return { dir, status };
      }
      dir = trimmed;
      await kv.set(DIR_KEY, dir);
      seen = null;
      status = dir === "" ? { kind: "off" } : { kind: "pending" };
      published("sync");
      await tick();
      return { dir, status };
    },
    tick,
    idle: () => queue,
  };
};

/** RPC папки синхронизации для страницы Flow; смена итога сверки идёт по своему каналу. */
export const registerFlowSyncApi = (bb: Pick<BbPluginApi, "rpc">, sync: FlowSync): void => {
  bb.rpc.register(flowSyncRpcContract, {
    getFlowSync: async () => sync.state(),
    setFlowSyncDir: ({ dir }) => sync.setDir(dir),
  });
};

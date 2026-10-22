// Оболочка возврата плагинов из дерева треда в основную копию (core/plugin-homecoming.ts): читает плагины bb, корни
// проектов и какие папки на месте, при устаревших зависимостях ставит их заново и ставит плагин из основной копии.
// Один плагин, который не встал, не мешает остальным: его провал уходит в лог, плагин остаётся, где стоял.
import { execFile } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { depsIncomplete, depsStale, homeCandidates, planHomecoming, treeInstall, type HeldPlugin, type HomecomingTrigger, type NpmLock } from "../core/plugin-homecoming";

/** Срез bb.sdk: SDK подходит как есть. */
export interface HomecomingPorts {
  readonly plugins: {
    list(): Promise<{ plugins: readonly HeldPlugin[] }>;
    install(args: { source: string }): Promise<unknown>;
  };
  readonly projects: { list(): Promise<readonly { sources: readonly { path: string }[] }[]> };
  readonly warn: (message: string) => void;
  /** Есть ли папка плагина; по умолчанию — читаемый package.json в ней. */
  readonly hasPlugin?: (dir: string) => Promise<boolean>;
  /** Ставит зависимости папки по её lock; по умолчанию — `npm ci`. */
  readonly installDeps?: (dir: string) => Promise<void>;
}

const packageJsonIn = (dir: string): Promise<boolean> =>
  access(join(dir, "package.json")).then(
    () => true,
    () => false,
  );

/** Сборке нужны и dev-пакеты — SDK среди них; окружение bb может выставить NODE_ENV=production, и npm пропустил бы их. */
const NPM_CI = ["ci", "--include=dev", "--no-audit", "--no-fund"];
const NPM_TIMEOUT_MS = 5 * 60_000;

const npmCi = async (dir: string): Promise<void> => {
  await promisify(execFile)("npm", NPM_CI, { cwd: dir, timeout: NPM_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
};

const mtime = (path: string): Promise<number | null> => stat(path).then(
  (s) => s.mtimeMs,
  () => null,
);

/** Lock-файл, который не прочесть (нет файла, оборванный npm), — всё равно что его нет. */
const lockAt = (path: string): Promise<NpmLock | null> => readFile(path, "utf8").then(
  (text) => {
    try {
      return JSON.parse(text) as NpmLock;
    } catch {
      return null;
    }
  },
  () => null,
);

/** Зависимости папки устарели или поставлены не все — `npm ci` нужен до сборки. */
const depsNeeded = async (dir: string): Promise<boolean> => {
  const lock = join(dir, "package-lock.json");
  const installed = join(dir, "node_modules", ".package-lock.json");
  return depsStale(await mtime(lock), await mtime(installed)) || depsIncomplete(await lockAt(lock), await lockAt(installed));
};

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Сверяет установки по поводу и возвращает плагины из деревьев тредов в основную копию; отдаёт id вернувшихся. */
export async function bringPluginsHome(ports: HomecomingPorts, trigger: HomecomingTrigger, ownPluginId: string): Promise<string[]> {
  const hasPlugin = ports.hasPlugin ?? packageJsonIn;
  const installDeps = ports.installDeps ?? npmCi;
  const { plugins } = await ports.plugins.list();
  const installs = plugins.flatMap((plugin) => treeInstall(plugin) ?? []);
  if (installs.length === 0) return [];
  const projectRoots = (await ports.projects.list()).flatMap((project) => project.sources.map((source) => source.path));
  const dirs = [...new Set(installs.flatMap((install) => [install.from, ...homeCandidates(install, projectRoots)]))];
  const present = await Promise.all(dirs.map(async (dir) => ((await hasPlugin(dir)) ? [dir] : [])));
  const moves = planHomecoming({ plugins, projectRoots, existing: new Set(present.flat()), trigger, ownPluginId });
  const moved: string[] = [];
  for (const move of moves) {
    // Зависимости, которые не встали, — не повод не пробовать: установка сама скажет, чего не хватило.
    if (await depsNeeded(move.to)) {
      await installDeps(move.to).catch((error) => ports.warn(`plugin ${move.pluginId}: npm ci in ${move.to} failed: ${message(error)}`));
    }
    try {
      await ports.plugins.install({ source: `path:${move.to}` });
      moved.push(move.pluginId);
    } catch (error) {
      ports.warn(`plugin ${move.pluginId} not moved from ${move.from} to ${move.to}: ${message(error)}`);
    }
  }
  return moved;
}

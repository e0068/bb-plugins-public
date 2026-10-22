// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bringPluginsHome, type HomecomingPorts } from "./plugin-homecoming";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

/** Плагин основной копии, чья установка свежее lock, но без пакета из него: installed — что записано в отметке установки. */
const disk = (installed: string) => {
  const root = mkdtempSync(join(tmpdir(), "homecoming-incomplete-"));
  roots.push(root);
  const dir = join(root, "Projects", "bb-plugins", "bb-plugin-tasks-plus");
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  writeFileSync(join(dir, "package.json"), "{}");
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ packages: { "": {}, "node_modules/@get-bb/plugin-sdk": {} } }));
  utimesSync(join(dir, "package-lock.json"), 1000, 1000);
  writeFileSync(join(dir, "node_modules", ".package-lock.json"), installed);
  utimesSync(join(dir, "node_modules", ".package-lock.json"), 2000, 2000);
  return { main: join(root, "Projects", "bb-plugins"), dir, from: join(root, "worktrees", "thr_gone-1", "bb-plugins", "bb-plugin-tasks-plus") };
};

const depsRunFor = async (installed: string): Promise<string[]> => {
  const { main, dir, from } = disk(installed);
  const deps: string[] = [];
  const port: HomecomingPorts = {
    plugins: { list: async () => ({ plugins: [{ id: "tasks-plus", source: `path:${from}` }] }), install: async () => undefined },
    projects: { list: async () => [{ sources: [{ path: main }] }] },
    warn: () => undefined,
    installDeps: async (d) => void deps.push(d),
  };
  await bringPluginsHome(port, { kind: "startup" }, "flow");
  return deps.map((d) => (d === dir ? "plugin dir" : d));
};

describe("установка основной копии без части пакетов ставится заново перед возвратом", () => {
  it("свежая установка без dev-пакета из lock — зависимости ставятся", async () =>
    expect(await depsRunFor(JSON.stringify({ packages: {} }))).toEqual(["plugin dir"]));
  it("битая отметка установки считается отсутствующей — зависимости ставятся, сверка не падает", async () =>
    expect(await depsRunFor("{ not json")).toEqual(["plugin dir"]));
});

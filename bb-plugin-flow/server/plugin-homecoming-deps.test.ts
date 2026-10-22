// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bringPluginsHome, type HomecomingPorts } from "./plugin-homecoming";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

/** Основная копия на настоящем диске: у каждого плагина package.json и package-lock.json, у свежих — ещё и отметка установки новее lock. */
const disk = (stale: string[], fresh: string[]) => {
  const root = mkdtempSync(join(tmpdir(), "homecoming-deps-"));
  roots.push(root);
  const main = join(root, "Projects", "bb-plugins");
  for (const id of [...stale, ...fresh]) {
    const dir = join(main, `bb-plugin-${id}`);
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    writeFileSync(join(dir, "package.json"), "{}");
    writeFileSync(join(dir, "package-lock.json"), "{}");
    utimesSync(join(dir, "package-lock.json"), 1000, 1000);
    if (fresh.includes(id)) {
      writeFileSync(join(dir, "node_modules", ".package-lock.json"), "{}");
      utimesSync(join(dir, "node_modules", ".package-lock.json"), 2000, 2000);
    }
  }
  return { main, tree: (id: string) => join(root, "worktrees", "thr_gone-1", "bb-plugins", `bb-plugin-${id}`) };
};

describe("перед возвратом в основную копию её устаревшие зависимости ставятся заново", () => {
  it("зависимости ставятся только у плагина с устаревшей установкой и раньше самой установки плагина", async () => {
    const { main, tree } = disk(["tasks-plus"], ["mail"]);
    const events: string[] = [];
    const port: HomecomingPorts = {
      plugins: {
        list: async () => ({ plugins: [{ id: "tasks-plus", source: `path:${tree("tasks-plus")}` }, { id: "mail", source: `path:${tree("mail")}` }] }),
        install: async ({ source }) => void events.push(`install ${source}`),
      },
      projects: { list: async () => [{ sources: [{ path: main }] }] },
      warn: () => undefined,
      installDeps: async (dir) => void events.push(`deps ${dir}`),
    };
    await bringPluginsHome(port, { kind: "startup" }, "flow");
    expect(events).toEqual([
      `deps ${join(main, "bb-plugin-tasks-plus")}`,
      `install path:${join(main, "bb-plugin-tasks-plus")}`,
      `install path:${join(main, "bb-plugin-mail")}`,
    ]);
  });

  it("провал установки зависимостей виден в логе, а плагин всё равно ставится", async () => {
    const { main, tree } = disk(["tasks-plus"], []);
    const installed: string[] = [];
    const warnings: string[] = [];
    const port: HomecomingPorts = {
      plugins: { list: async () => ({ plugins: [{ id: "tasks-plus", source: `path:${tree("tasks-plus")}` }] }), install: async ({ source }) => void installed.push(source) },
      projects: { list: async () => [{ sources: [{ path: main }] }] },
      warn: (m) => warnings.push(m),
      installDeps: async () => {
        throw new Error("npm ERR! network");
      },
    };
    await bringPluginsHome(port, { kind: "startup" }, "flow");
    expect(installed).toEqual([`path:${join(main, "bb-plugin-tasks-plus")}`]);
    expect(warnings).toEqual([expect.stringContaining("npm ERR! network")]);
  });
});

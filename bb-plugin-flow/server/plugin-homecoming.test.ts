// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bringPluginsHome, type HomecomingPorts } from "./plugin-homecoming";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

/** Основная копия bb-plugins с папками плагинов на настоящем диске и пустой каталог деревьев тредов. */
const disk = (plugins: string[]) => {
  const root = mkdtempSync(join(tmpdir(), "homecoming-"));
  roots.push(root);
  const main = join(root, "Projects", "bb-plugins");
  for (const id of plugins) {
    mkdirSync(join(main, `bb-plugin-${id}`), { recursive: true });
    writeFileSync(join(main, `bb-plugin-${id}`, "package.json"), "{}");
  }
  return { main, tree: (thread: string, id: string) => join(root, "worktrees", `${thread}-1`, "bb-plugins", `bb-plugin-${id}`) };
};

const ports = (held: { id: string; source: string }[], main: string, failing: string[] = []) => {
  const installed: string[] = [];
  const warnings: string[] = [];
  const port: HomecomingPorts = {
    plugins: {
      list: async () => ({ plugins: held }),
      install: async ({ source }) => {
        if (failing.some((id) => source.endsWith(`bb-plugin-${id}`))) throw new Error("frontend bundle build failed");
        installed.push(source);
      },
    },
    projects: { list: async () => [{ sources: [{ path: main }] }] },
    warn: (m) => warnings.push(m),
  };
  return { port, installed, warnings };
};

describe("Flow возвращает плагины из дерева треда в основную копию", () => {
  it("при запуске плагин без папки в дереве встаёт из основной копии, а провал одного не мешает другому", async () => {
    const { main, tree } = disk(["tasks-plus", "mail"]);
    const { port, installed, warnings } = ports(
      [
        { id: "mail", source: `path:${tree("thr_gone", "mail")}` },
        { id: "tasks-plus", source: `path:${tree("thr_gone", "tasks-plus")}` },
      ],
      main,
      ["mail"],
    );
    const moved = await bringPluginsHome(port, { kind: "startup" }, "flow");
    expect(moved).toEqual(["tasks-plus"]);
    expect(installed).toEqual([`path:${join(main, "bb-plugin-tasks-plus")}`]);
    expect(warnings).toEqual([expect.stringContaining("mail")]);
  });

  it("без установок из деревьев тредов ничего не ставится", async () => {
    const { main } = disk(["mail"]);
    const { port, installed } = ports([{ id: "mail", source: `path:${join(main, "bb-plugin-mail")}` }], main);
    expect(await bringPluginsHome(port, { kind: "startup" }, "flow")).toEqual([]);
    expect(installed).toEqual([]);
  });
});

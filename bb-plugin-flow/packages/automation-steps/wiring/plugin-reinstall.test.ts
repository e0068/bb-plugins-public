import { describe, expect, it } from "vitest";
import {
  applyPendingSelfUpdate,
  reinstallTouchedPlugins,
  repointPlugin,
  type PluginsPort,
  type ReinstallReport,
  type ReinstallTarget,
} from "./plugin-reinstall";

interface Installed {
  id: string;
  source: string;
  version?: string;
}

interface Fake {
  port: PluginsPort;
  calls: string[];
}

/** An in-memory bb: `list` reflects what `install`/`remove` did; named ids fail. */
function fakePlugins(
  installed: readonly Installed[],
  failing: { applyUpdate?: readonly string[]; install?: readonly string[] } = {},
): Fake {
  const calls: string[] = [];
  let plugins = [...installed];
  const port: PluginsPort = {
    async list() {
      return { plugins: plugins.map((plugin) => ({ ...plugin })) };
    },
    async applyUpdate({ pluginId }) {
      calls.push(`applyUpdate ${pluginId}`);
      if (failing.applyUpdate?.includes(pluginId)) throw new Error(`update of "${pluginId}" refused`);
    },
    async install({ source, subdirectory }) {
      calls.push(`install ${source}${subdirectory === undefined ? "" : ` ${subdirectory}`}`);
      if (failing.install?.some((s) => source.includes(s))) throw new Error(`cannot install ${source}`);
      plugins = [...plugins, { id: subdirectory?.replace(/^bb-plugin-/, "") ?? "?", source }];
    },
    async remove({ pluginId }) {
      calls.push(`remove ${pluginId}`);
      plugins = plugins.filter((plugin) => plugin.id !== pluginId);
    },
  };
  return { port, calls };
}

const target: ReinstallTarget = {
  repo: { owner: "e0068", repo: "bb-plugins" },
  baseBranch: "main",
  ownPluginId: "zz-pull-request",
};
const gitSource = "git:https://github.com/e0068/bb-plugins.git@main";
const pathSource = "path:/Users/x/worktrees/bb-plugins/bb-plugin-tasks-plus";

describe("reinstallTouchedPlugins", () => {
  it("a touched plugin installed from git of the same repository → applyUpdate, reported as reinstalled", async () => {
    const { port, calls } = fakePlugins([{ id: "tasks-plus", source: gitSource }]);
    const report = await reinstallTouchedPlugins(port, ["bb-plugin-tasks-plus/server.ts"], target);
    expect(report).toEqual({
      reinstalled: ["tasks-plus"],
      installed: [],
      repoints: [],
      keptLocal: [],
      problems: [],
      pendingSelfUpdate: null,
    });
    expect(calls).toEqual(["applyUpdate tasks-plus"]);
  });

  it("a touched plugin installed from a path → nothing changed, a repoint waits for the user's word", async () => {
    const { port, calls } = fakePlugins([{ id: "tasks-plus", source: pathSource }]);
    const report = await reinstallTouchedPlugins(port, ["bb-plugin-tasks-plus/server.ts"], target);
    expect(report).toEqual({
      reinstalled: [],
      installed: [],
      repoints: [
        { pluginId: "tasks-plus", from: pathSource, source: gitSource, subdirectory: "bb-plugin-tasks-plus" },
      ],
      keptLocal: [],
      problems: [],
      pendingSelfUpdate: null,
    });
    expect(calls).toEqual([]);
  });

  it("a touched plugin not installed at all → installed from git right away", async () => {
    const { port, calls } = fakePlugins([]);
    const report = await reinstallTouchedPlugins(port, ["bb-plugin-tasks-plus/app.tsx"], target);
    expect(report).toEqual({
      reinstalled: [],
      installed: ["tasks-plus"],
      repoints: [],
      keptLocal: [],
      problems: [],
      pendingSelfUpdate: null,
    });
    expect(calls).toEqual([`install ${gitSource} bb-plugin-tasks-plus`]);
  });

  it("the plugin running this code, on a path source → kept where it is and named, no problem, no call", async () => {
    const { port, calls } = fakePlugins([{ id: "zz-pull-request", source: "path:/x/bb-plugin-zz-pull-request" }]);
    const report = await reinstallTouchedPlugins(port, ["bb-plugin-zz-pull-request/server.ts"], target);
    expect(report.keptLocal).toEqual([{ pluginId: "zz-pull-request", from: "path:/x/bb-plugin-zz-pull-request" }]);
    expect(report.repoints).toEqual([]);
    expect(report.problems).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("the plugin running this code, on git → not updated here, handed back for the caller to run last", async () => {
    const { port, calls } = fakePlugins([
      { id: "zz-pull-request", source: gitSource },
      { id: "tasks-plus", source: gitSource },
    ]);
    const report = await reinstallTouchedPlugins(
      port,
      ["bb-plugin-zz-pull-request/server.ts", "bb-plugin-tasks-plus/app.tsx"],
      target,
    );
    expect(report.pendingSelfUpdate).toBe("zz-pull-request");
    expect(report.reinstalled).toEqual(["tasks-plus"]);
    expect(report.problems).toEqual([]);
    expect(calls).toEqual(["applyUpdate tasks-plus"]);
  });

  it("several plugins → each handled by its own source, in the order the paths name them", async () => {
    const { port, calls } = fakePlugins([
      { id: "tasks-plus", source: pathSource },
      { id: "plugins-monitor", source: gitSource },
    ]);
    const report = await reinstallTouchedPlugins(
      port,
      ["bb-plugin-tasks-plus/server.ts", "bb-plugin-plugins-monitor/app.tsx", "bb-plugin-projects/x.ts"],
      target,
    );
    expect(report.reinstalled).toEqual(["plugins-monitor"]);
    expect(report.installed).toEqual(["projects"]);
    expect(report.repoints.map((r) => r.pluginId)).toEqual(["tasks-plus"]);
    expect(calls).toEqual([
      "applyUpdate plugins-monitor",
      `install ${gitSource} bb-plugin-projects`,
    ]);
  });

  it("one step fails → the reason names the plugin, its source and the version left installed; the rest are still attempted", async () => {
    const { port, calls } = fakePlugins(
      [
        { id: "tasks-plus", source: gitSource, version: "0.2.0" },
        { id: "plugins-monitor", source: gitSource },
      ],
      { applyUpdate: ["tasks-plus"] },
    );
    const report = await reinstallTouchedPlugins(
      port,
      ["bb-plugin-tasks-plus/server.ts", "bb-plugin-plugins-monitor/app.tsx"],
      target,
    );
    expect(report.reinstalled).toEqual(["plugins-monitor"]);
    expect(report.problems).toEqual([
      `"tasks-plus" from ${gitSource}, version 0.2.0 still installed: update of "tasks-plus" refused`,
    ]);
    expect(calls).toEqual(["applyUpdate tasks-plus", "applyUpdate plugins-monitor"]);
  });

  it("no plugin directory among the paths → nothing called, nothing reported", async () => {
    const { port, calls } = fakePlugins([{ id: "tasks-plus", source: pathSource }]);
    expect(await reinstallTouchedPlugins(port, ["docs/INDEX.md", "README.md"], target)).toEqual({
      reinstalled: [],
      installed: [],
      repoints: [],
      keptLocal: [],
      problems: [],
      pendingSelfUpdate: null,
    });
    expect(calls).toEqual([]);
  });
});

describe("reinstallTouchedPlugins — общий пакет", () => {
  const imports = async () => ({
    ok: true as const,
    edges: [
      { from: { kind: "plugin" as const, name: "tasks-plus" }, to: "automation-steps" },
      { from: { kind: "plugin" as const, name: "zz-pull-request" }, to: "automation-steps" },
      { from: { kind: "plugin" as const, name: "projects" }, to: "automation-steps" },
    ],
  });

  it("правка пакета обновляет установленный из git плагин, который его собирает", async () => {
    const { port, calls } = fakePlugins([{ id: "tasks-plus", source: gitSource }]);
    const report = await reinstallTouchedPlugins(port, ["packages/automation-steps/steps.ts"], target, imports);
    expect(report.reinstalled).toEqual(["tasks-plus"]);
    expect(report.problems).toEqual([]);
    expect(calls).toEqual(["applyUpdate tasks-plus"]);
  });

  it("плагин, который собирает пакет, но не установлен, не ставится", async () => {
    const { port, calls } = fakePlugins([]);
    const report = await reinstallTouchedPlugins(port, ["packages/automation-steps/steps.ts"], target, imports);
    expect(report.installed).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("плагин, ведущий цепочку, через пакет уходит в отложенное самообновление", async () => {
    const { port, calls } = fakePlugins([{ id: "zz-pull-request", source: gitSource }]);
    const report = await reinstallTouchedPlugins(port, ["packages/automation-steps/steps.ts"], target, imports);
    expect(report.pendingSelfUpdate).toBe("zz-pull-request");
    expect(calls).toEqual([]);
  });

  it("плагины из path: и npm через пакет разбираются так же, как прямые: перенаправление, без вызовов", async () => {
    const { port, calls } = fakePlugins([
      { id: "tasks-plus", source: pathSource },
      { id: "projects", source: "npm:@e0068/bb-plugin-projects@1.0.0" },
    ]);
    const report = await reinstallTouchedPlugins(port, ["packages/automation-steps/steps.ts"], target, imports);
    expect(report.repoints.map((r) => r.pluginId)).toEqual(["tasks-plus", "projects"]);
    expect(report.reinstalled).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("без правок в packages/ граф импортов не читается", async () => {
    const { port } = fakePlugins([{ id: "tasks-plus", source: gitSource }]);
    let read = 0;
    await reinstallTouchedPlugins(port, ["bb-plugin-tasks-plus/app.tsx", "docs/INDEX.md"], target, async () => {
      read += 1;
      return imports();
    });
    expect(read).toBe(0);
  });

  it("граф не прочитан — проблема называет пакет, прямые плагины всё равно обновлены", async () => {
    const { port, calls } = fakePlugins([{ id: "tasks-plus", source: gitSource }]);
    const report = await reinstallTouchedPlugins(
      port,
      ["bb-plugin-tasks-plus/app.tsx", "packages/automation-steps/steps.ts"],
      target,
      async () => ({ ok: false as const, reason: "not a git repository" }),
    );
    expect(report.reinstalled).toEqual(["tasks-plus"]);
    expect(report.problems).toEqual([
      "plugins that build packages/automation-steps not found: not a git repository",
    ]);
    expect(calls).toEqual(["applyUpdate tasks-plus"]);
  });
});

describe("applyPendingSelfUpdate", () => {
  const reportWith = (pendingSelfUpdate: string | null): ReinstallReport => ({
    reinstalled: ["tasks-plus"],
    installed: [],
    repoints: [],
    keptLocal: [],
    problems: [],
    pendingSelfUpdate,
  });

  it("nothing pending → the same report, nothing called", async () => {
    const { port, calls } = fakePlugins([{ id: "zz-pull-request", source: gitSource }]);
    expect(await applyPendingSelfUpdate(port, reportWith(null))).toEqual(reportWith(null));
    expect(calls).toEqual([]);
  });

  it("pending → updates the plugin and reports it reinstalled with the rest", async () => {
    const { port, calls } = fakePlugins([{ id: "zz-pull-request", source: gitSource }]);
    expect(await applyPendingSelfUpdate(port, reportWith("zz-pull-request"))).toEqual({
      reinstalled: ["tasks-plus", "zz-pull-request"],
      installed: [],
      repoints: [],
      keptLocal: [],
      problems: [],
      pendingSelfUpdate: null,
    });
    expect(calls).toEqual(["applyUpdate zz-pull-request"]);
  });

  it("a refused self-update is a problem naming its source and installed version, never a throw", async () => {
    const { port } = fakePlugins([{ id: "zz-pull-request", source: gitSource, version: "1.4.2" }], {
      applyUpdate: ["zz-pull-request"],
    });
    const report = await applyPendingSelfUpdate(port, reportWith("zz-pull-request"));
    expect(report.reinstalled).toEqual(["tasks-plus"]);
    expect(report.problems).toEqual([
      `"zz-pull-request" from ${gitSource}, version 1.4.2 still installed: update of "zz-pull-request" refused`,
    ]);
    expect(report.pendingSelfUpdate).toBeNull();
  });
});

describe("repointPlugin", () => {
  const request = { pluginId: "tasks-plus", source: gitSource, subdirectory: "bb-plugin-tasks-plus" };

  it("removes the old install, then installs from git with the plugin's directory", async () => {
    const { port, calls } = fakePlugins([{ id: "tasks-plus", source: pathSource }]);
    await repointPlugin(port, request);
    expect(calls).toEqual(["remove tasks-plus", `install ${gitSource} bb-plugin-tasks-plus`]);
    expect((await port.list()).plugins).toEqual([{ id: "tasks-plus", source: gitSource }]);
  });

  it("the git install fails → the previous path source goes back in, and the failure is thrown", async () => {
    const { port, calls } = fakePlugins([{ id: "tasks-plus", source: pathSource }], {
      install: ["github.com"],
    });
    await expect(repointPlugin(port, request)).rejects.toThrow(`cannot install ${gitSource}`);
    expect(calls).toEqual([
      "remove tasks-plus",
      `install ${gitSource} bb-plugin-tasks-plus`,
      `install ${pathSource}`,
    ]);
  });

  it("the previous source was git of another repository → it is restored with the same directory", async () => {
    const other = "git:https://github.com/e0068/bb-plugins-public.git@main";
    const { port, calls } = fakePlugins([{ id: "tasks-plus", source: other }], { install: ["e0068/bb-plugins.git"] });
    await expect(repointPlugin(port, request)).rejects.toThrow();
    expect(calls.at(-1)).toBe(`install ${other} bb-plugin-tasks-plus`);
  });

  it("nothing installed under the id any more → a plain install, no remove", async () => {
    const { port, calls } = fakePlugins([]);
    await repointPlugin(port, request);
    expect(calls).toEqual([`install ${gitSource} bb-plugin-tasks-plus`]);
  });
});

import { describe, expect, it } from "vitest";
import { planHomecoming, type HomecomingFacts } from "./plugin-homecoming";

const TREES = "/Users/o/.bb/plugins/environment-git-worktree/host-data/worktrees";
const MAIN = "/Users/o/Projects/bb-plugins";
const treeOf = (thread: string, plugin: string) => `${TREES}/${thread}-1/bb-plugins/bb-plugin-${plugin}`;

const facts = (over: Partial<HomecomingFacts> = {}): HomecomingFacts => ({
  plugins: [],
  projectRoots: [MAIN],
  existing: new Set(),
  trigger: { kind: "startup" },
  ownPluginId: "flow",
  ...over,
});

describe("плагин из дерева треда возвращается в основную копию", () => {
  it("тред архивирован — его плагин переезжает в ту же папку основной копии", () => {
    const plan = planHomecoming(
      facts({
        plugins: [{ id: "tasks-plus", source: `path:${treeOf("thr_a", "tasks-plus")}` }],
        existing: new Set([`${MAIN}/bb-plugin-tasks-plus`]),
        trigger: { kind: "archived", threadId: "thr_a" },
      }),
    );
    expect(plan).toEqual([{ pluginId: "tasks-plus", from: treeOf("thr_a", "tasks-plus"), to: `${MAIN}/bb-plugin-tasks-plus` }]);
  });

  it("архив другого треда не трогает плагин, который стоит из живого дерева", () => {
    const plan = planHomecoming(
      facts({
        plugins: [{ id: "tasks-plus", source: `path:${treeOf("thr_live", "tasks-plus")}` }],
        existing: new Set([treeOf("thr_live", "tasks-plus"), `${MAIN}/bb-plugin-tasks-plus`]),
        trigger: { kind: "archived", threadId: "thr_a" },
      }),
    );
    expect(plan).toEqual([]);
  });

  it("плагина нет в основной копии — он остаётся, где стоял", () => {
    const plan = planHomecoming(
      facts({
        plugins: [{ id: "brand-new", source: `path:${treeOf("thr_a", "brand-new")}` }],
        trigger: { kind: "archived", threadId: "thr_a" },
      }),
    );
    expect(plan).toEqual([]);
  });

  it("при запуске плагин, чьей папки в дереве треда уже нет, возвращается в основную копию", () => {
    const plan = planHomecoming(
      facts({
        plugins: [
          { id: "tasks-plus", source: `path:${treeOf("thr_gone", "tasks-plus")}` },
          { id: "mail", source: `path:${treeOf("thr_live", "mail")}` },
        ],
        existing: new Set([treeOf("thr_live", "mail"), `${MAIN}/bb-plugin-tasks-plus`, `${MAIN}/bb-plugin-mail`]),
      }),
    );
    expect(plan).toEqual([{ pluginId: "tasks-plus", from: treeOf("thr_gone", "tasks-plus"), to: `${MAIN}/bb-plugin-tasks-plus` }]);
  });

  it("установки не из дерева треда — основная копия, git, npm, встроенные — не трогаются", () => {
    const plan = planHomecoming(
      facts({
        plugins: [
          { id: "mail", source: `path:${MAIN}/bb-plugin-mail` },
          { id: "projects", source: "git:https://github.com/o/bb-plugins.git@main" },
          { id: "fonts", source: "npm:bb-plugin-fonts@^0.1.0" },
          { id: "tasks", source: "builtin:tasks" },
        ],
        trigger: { kind: "archived", threadId: "thr_a" },
      }),
    );
    expect(plan).toEqual([]);
  });

  it("основная копия ищется среди проектов по имени папки репозитория", () => {
    const other = "/Users/o/Projects/Shapeshift";
    const plan = planHomecoming(
      facts({
        plugins: [{ id: "x", source: `path:${TREES}/thr_a-2/Shapeshift/plugins/x` }],
        projectRoots: [MAIN, other],
        existing: new Set([`${MAIN}/plugins/x`, `${other}/plugins/x`]),
        trigger: { kind: "archived", threadId: "thr_a" },
      }),
    );
    expect(plan).toEqual([{ pluginId: "x", from: `${TREES}/thr_a-2/Shapeshift/plugins/x`, to: `${other}/plugins/x` }]);
  });

  it("сам Flow переезжает последним: его переустановка гасит обработчик", () => {
    const plan = planHomecoming(
      facts({
        plugins: [
          { id: "flow", source: `path:${treeOf("thr_a", "flow")}` },
          { id: "tasks-plus", source: `path:${treeOf("thr_a", "tasks-plus")}` },
        ],
        existing: new Set([`${MAIN}/bb-plugin-flow`, `${MAIN}/bb-plugin-tasks-plus`]),
        trigger: { kind: "archived", threadId: "thr_a" },
      }),
    );
    expect(plan.map((step) => step.pluginId)).toEqual(["tasks-plus", "flow"]);
  });
});

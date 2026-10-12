// @vitest-environment node
// Раздел Workflows страницы Flow: список файлов `~/.claude/workflows` с описанием и причиной, если конструктор не читает файл деревом.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { blankTree, compile } from "@bb-plugins/workflow-builder/model";
import { registerWorkflowFiles } from "./workflow-files";

const DIR = "/h/.claude/workflows";
const built = (() => {
  const t = blankTree("review");
  t.description = "Reviews";
  return compile(t, "claude");
})();

const setup = (files: Record<string, string>) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  registerWorkflowFiles(bb, {
    dir: DIR,
    listDir: async (dir) => {
      const names = Object.keys(files).filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1));
      if (names.length === 0) throw Object.assign(new Error(`ENOENT ${dir}`), { code: "ENOENT" });
      return names;
    },
    readFile: async (path) => files[path] ?? Promise.reject(new Error(`ENOENT ${path}`)),
    writeFile: async () => {},
    agents: async () => [],
    providers: async () => [],
  });
  return harness;
};

describe("список workflow для страницы Flow", () => {
  it("файлы верхнего уровня .js по имени, с описанием и причиной; прочее не входит", async () => {
    const harness = setup({
      [`${DIR}/review.js`]: built,
      [`${DIR}/epic.js`]: 'export const meta = { name: "epic", description: "Эпик" }\n',
      [`${DIR}/epic.test.cjs`]: "",
      [`${DIR}/notes.md`]: "",
    });
    expect(await harness.callRpc("workflowList", null)).toEqual({
      dir: DIR,
      items: [
        { name: "epic", path: `${DIR}/epic.js`, description: "Эпик", reason: "hand-written" },
        { name: "review", path: `${DIR}/review.js`, description: "Reviews", reason: null },
      ],
    });
  });

  it("папки нет — пустой список с той же папкой: туда ляжет первый новый workflow", async () => {
    expect(await setup({}).callRpc("workflowList", null)).toEqual({ dir: DIR, items: [] });
  });
});

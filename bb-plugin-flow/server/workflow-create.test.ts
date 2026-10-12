// @vitest-environment node
// Новый workflow создаётся только на свободном месте: файл с тем же именем, появившийся после открытия списка, не затирается.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { registerWorkflowFiles } from "./workflow-files";

const DIR = "/h/.claude/workflows";

const setup = (files: Record<string, string>, listDir: (dir: string) => Promise<string[]> = async () => Object.keys(files).map((p) => p.slice(DIR.length + 1))) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  registerWorkflowFiles(bb, {
    dir: DIR,
    listDir,
    readFile: async (path) => files[path] ?? Promise.reject(new Error(`ENOENT ${path}`)),
    writeFile: async (path, text, exclusive) => {
      if (exclusive && path in files) throw Object.assign(new Error(`EEXIST ${path}`), { code: "EEXIST" });
      files[path] = text;
    },
    agents: async () => [],
    providers: async () => [],
  });
  return harness;
};

describe("создание workflow", () => {
  it("свободное имя — файл создаётся", async () => {
    const files: Record<string, string> = {};
    await setup(files).callRpc("workflowSave", { path: `${DIR}/ship-it.js`, source: "// new", create: true });
    expect(files[`${DIR}/ship-it.js`]).toBe("// new");
  });

  it("занятое имя — отказ, файл не тронут", async () => {
    const files: Record<string, string> = { [`${DIR}/epic.js`]: "// epic" };
    await expect(setup(files).callRpc("workflowSave", { path: `${DIR}/epic.js`, source: "// new", create: true })).rejects.toBeTruthy();
    expect(files[`${DIR}/epic.js`]).toBe("// epic");
  });

  it("папка не читается не из-за отсутствия — список падает, а не притворяется пустым", async () => {
    const harness = setup({}, async () => Promise.reject(Object.assign(new Error("EACCES"), { code: "EACCES" })));
    await expect(harness.callRpc("workflowList", null)).rejects.toBeTruthy();
  });
});

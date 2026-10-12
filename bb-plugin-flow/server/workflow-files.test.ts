// @vitest-environment node
// Открыватель .js читает и пишет файл workflow через сервер Flow; путь за пределами папок workflow не читается и не пишется.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { registerWorkflowFiles, type WorkflowFileDeps } from "./workflow-files";

const setup = (files: Record<string, string> = {}) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const deps: WorkflowFileDeps = {
    readFile: async (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT ${path}`);
      return text;
    },
    writeFile: async (path, text) => {
      files[path] = text;
    },
    agents: async () => [{ value: "reviewer", model: "opus", effort: "", provider: "claude-code", path: "/h/.claude/agents/reviewer.md", scope: "user" }],
    providers: async () => [{ id: "claude-code", name: "Claude Code", models: [{ id: "opus", efforts: ["high"] }] }],
  };
  registerWorkflowFiles(bb, deps);
  return { harness, files };
};

describe("файлы workflow для открывателя", () => {
  it("читает и пишет файл workflow", async () => {
    const { harness, files } = setup({ "/h/.claude/workflows/epic.js": "export const meta = {}" });
    expect(await harness.callRpc("workflowRead", { path: "/h/.claude/workflows/epic.js" })).toEqual({ source: "export const meta = {}" });
    expect(await harness.callRpc("workflowSave", { path: "/w/repo/.bb/workflows/review.js", source: "// new" })).toEqual({ path: "/w/repo/.bb/workflows/review.js" });
    expect(files["/w/repo/.bb/workflows/review.js"]).toBe("// new");
  });

  it("не читает и не пишет за пределами папок workflow", async () => {
    const { harness, files } = setup({ "/h/.ssh/id_rsa": "secret" });
    await expect(harness.callRpc("workflowRead", { path: "/h/.ssh/id_rsa" })).rejects.toBeTruthy();
    await expect(harness.callRpc("workflowSave", { path: "/h/.claude/workflows/../settings.js", source: "x" })).rejects.toBeTruthy();
    await expect(harness.callRpc("workflowSave", { path: "/h/.claude/agents/x.js", source: "x" })).rejects.toBeTruthy();
    expect(Object.keys(files)).toEqual(["/h/.ssh/id_rsa"]);
  });

  it("отдаёт агентов шаблона и модели провайдеров", async () => {
    const { harness } = setup();
    expect(await harness.callRpc("workflowAgents", null)).toEqual([expect.objectContaining({ value: "reviewer" })]);
    expect(await harness.callRpc("workflowProviders", null)).toEqual([expect.objectContaining({ id: "claude-code" })]);
  });
});

// @vitest-environment node
// Инструменты агента над workflow: прочитать деревом или узнать, почему конструктор файл не узнаёт, и записать из дерева так,
// что конструктор узнаёт записанное. Рукописный файл инструмент не перезаписывает.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { compile, recognize } from "@bb-plugins/workflow-builder/model";
import { registerWorkflowTools, WORKFLOW_READ_TOOL_NAME, WORKFLOW_WRITE_TOOL_NAME } from "./workflow-tools";

const DIR = "/h/.claude/workflows";

const setup = (files: Record<string, string> = {}) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  registerWorkflowTools(bb, {
    dir: DIR,
    readFile: async (path) => {
      const text = files[path];
      if (text === undefined) throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
      return text;
    },
    writeFile: async (path, text) => {
      files[path] = text;
    },
  });
  const call = async (name: string, input: unknown) => {
    const result = (await harness.callAgentTool(name, input, { threadId: "t1" } as never)) as { isError?: boolean; content: Array<{ text: string }> };
    return { error: result.isError === true, text: result.content.map((c) => c.text).join("\n") };
  };
  return { call, files };
};

const tree = {
  name: "write-review",
  description: "Writes, then reviews",
  phases: [{ title: "Write", steps: [{ type: "agent", label: "writer", prompt: "Write {{args}}", agentType: "implementer" }] }],
};

describe("workflow_write", () => {
  it("пишет файл, который конструктор узнаёт деревом", async () => {
    const { call, files } = setup();
    const result = await call(WORKFLOW_WRITE_TOOL_NAME, { tree });
    expect(result.error).toBe(false);
    const written = files[`${DIR}/write-review.js`]!;
    expect(recognize(written, "claude").kind).toBe("tree");
  });

  it("кривое дерево — отказ с проблемами по пути узла, ничего не пишется", async () => {
    const { call, files } = setup();
    const result = await call(WORKFLOW_WRITE_TOOL_NAME, { tree: { ...tree, phases: [{ title: "x", steps: [{ type: "loop" }] }] } });
    expect(result.error).toBe(true);
    expect(result.text).toContain('phases[0].steps[0].type: must be "agent" or "container"');
    expect(files).toEqual({});
  });

  it("рукописный файл с тем же именем не перезаписывается", async () => {
    const { call, files } = setup({ [`${DIR}/write-review.js`]: 'export const meta = { name: "write-review" }\nawait agent("x")\n' });
    const result = await call(WORKFLOW_WRITE_TOOL_NAME, { tree });
    expect(result.error).toBe(true);
    expect(result.text).toMatch(/written by hand/);
    expect(files[`${DIR}/write-review.js`]).toContain('await agent("x")');
  });

  it("шаг без agentType — отказ: конструктор пометил бы workflow невалидным", async () => {
    const { call, files } = setup();
    const result = await call(WORKFLOW_WRITE_TOOL_NAME, { tree: { ...tree, phases: [{ title: "x", steps: [{ type: "agent", label: "a", prompt: "p" }] }] } });
    expect(result.error).toBe(true);
    expect(result.text).toMatch(/without agentType/);
    expect(files).toEqual({});
  });

  it("свой же файл перезаписывается новым деревом", async () => {
    const { call, files } = setup();
    await call(WORKFLOW_WRITE_TOOL_NAME, { tree });
    const result = await call(WORKFLOW_WRITE_TOOL_NAME, { tree: { ...tree, description: "Second version" } });
    expect(result.error).toBe(false);
    expect(files[`${DIR}/write-review.js`]).toContain("Second version");
  });
});

describe("workflow_read", () => {
  it("файл конструктора — деревом", async () => {
    const { call } = setup();
    await call(WORKFLOW_WRITE_TOOL_NAME, { tree });
    const result = await call(WORKFLOW_READ_TOOL_NAME, { name: "write-review" });
    expect(result.error).toBe(false);
    expect(JSON.parse(result.text).tree.phases[0].steps[0].agentType).toBe("implementer");
  });

  it("рукописный и правленный руками — причина вместо дерева", async () => {
    const { call } = setup({
      [`${DIR}/epic.js`]: 'export const meta = { name: "epic" }\n',
      [`${DIR}/lead-waves.js`]: compile({ name: "lead-waves", description: "", phases: [] }, "claude").replace("\n// Made with Claude Config", "\nlet x = 1\n// Made with Claude Config"),
    });
    expect(JSON.parse((await call(WORKFLOW_READ_TOOL_NAME, { name: "epic" })).text).reason).toBe("hand-written");
    expect(JSON.parse((await call(WORKFLOW_READ_TOOL_NAME, { name: "lead-waves" })).text).reason).toBe("edited");
  });

  it("нет такого файла или имя уводит из папки — ошибка", async () => {
    const { call } = setup();
    expect((await call(WORKFLOW_READ_TOOL_NAME, { name: "nope" })).error).toBe(true);
    expect((await call(WORKFLOW_READ_TOOL_NAME, { name: "../agents/x" })).error).toBe(true);
  });
});

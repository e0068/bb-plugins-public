// @vitest-environment node
// Какой .js — файл workflow: его правая панель открывает конструктором, остальные .js — встроенным превью.
import { describe, expect, it } from "vitest";

import { workflowAgentOptions, workflowFileEngine } from "./workflow-file";

describe("файл workflow по пути", () => {
  it("верхний уровень ~/.claude/workflows — workflow Claude Code", () => {
    expect(workflowFileEngine("/Users/owner/.claude/workflows/epic.js")).toBe("claude");
  });

  it("верхний уровень .bb/workflows проекта — workflow bb", () => {
    expect(workflowFileEngine("/work/repo/.bb/workflows/review.js")).toBe("bb");
  });

  it("всё прочее — не workflow: другая папка, подпапка, другое расширение, тест рядом", () => {
    for (const path of [
      "/work/repo/src/app.js",
      "/Users/owner/.claude/workflows/sub/x.js",
      "/Users/owner/.claude/workflows/epic.test.cjs",
      "/Users/owner/.claude/workflows/notes.md",
      "/Users/owner/.claude/workflows/../agents/x.js",
      ".claude/workflows/relative.js",
    ])
      expect(workflowFileEngine(path)).toBeNull();
  });
});

describe("агенты для выбора шаблона шага", () => {
  it("агенты Claude Code каталога — тип агента без префикса, модель, описание, файл и откуда он", () => {
    const options = workflowAgentOptions([
      { executor: { id: "agent:reviewer", kind: "agent", name: "reviewer", model: "opus", description: "Ревьюер", origin: { kind: "own" } }, path: "/h/.claude/agents/reviewer.md" },
      { executor: { id: "agent:scout", kind: "agent", name: "scout", origin: { kind: "project", project: "bb" } }, path: "/w/.claude/agents/scout.md" },
      { executor: { id: "agent:cm:critic", kind: "agent", name: "critic", origin: { kind: "plugin", plugin: "cm" } }, path: "/c/agents/critic.md" },
    ]);
    expect(options).toEqual([
      { value: "reviewer", model: "opus", effort: "", provider: "", description: "Ревьюер", path: "/h/.claude/agents/reviewer.md", scope: "user" },
      { value: "scout", model: "", effort: "", provider: "", path: "/w/.claude/agents/scout.md", scope: "project" },
      { value: "cm:critic", model: "", effort: "", provider: "", path: "/c/agents/critic.md", scope: "plugin" },
    ]);
  });

  it("workflow и агенты Codex — не шаблоны шага Claude Code", () => {
    expect(
      workflowAgentOptions([
        { executor: { id: "workflow:epic", kind: "workflow", name: "epic" }, path: "/h/.claude/workflows/epic.js" },
        { executor: { id: "agent:codex/coder", kind: "agent", name: "coder", provider: "codex" }, path: "/h/.codex/agents/coder.toml" },
      ]),
    ).toEqual([]);
  });
});

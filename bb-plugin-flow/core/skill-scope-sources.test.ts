// @vitest-environment node
// Источники навыков помимо своих: workflow, навыки аккаунта claude.ai, встроенные навыки Claude Code, плагины,
// синхронизированные с claude.ai, и плагины с одними командами — переключатель навыков закрывает и их.
import { describe, expect, it } from "vitest";

import type { StageCatalog, WorkStage } from "../shared/contract";
import { BUILTIN_AGENTS, hiddenOf, mergeLocalSettings, NOTHING_HIDDEN, scopeOf, withoutOwnerKeys, type ClaudePlugin, type Hidden, type Scope } from "./skill-scope";

const agent = (name: string) => ({ id: `agent:${name}`, kind: "agent" as const, name });
const workflow = (name: string) => ({ id: `workflow:${name}`, kind: "workflow" as const, name });

const CATALOG: StageCatalog = {
  skills: [
    { name: "spec", origin: { kind: "own" } },
    { name: "plan", origin: { kind: "own" } },
    { name: "deploy", origin: { kind: "project" } },
    { name: "code-review:code-review", origin: { kind: "plugin", plugin: "code-review", provider: "claude-code" } },
  ],
  executors: [{ ...agent("scout"), origin: { kind: "own" } }, { ...agent("code-reviewer"), origin: { kind: "own" } }, workflow("lead-waves"), workflow("DEV1")],
};
const SYNCED: ClaudePlugin = { key: "sales@synced", name: "sales", skills: ["sales:forecast", "sales:call-prep"] };
const COMMANDS: ClaudePlugin = { key: "commit-commands@official", name: "commit-commands", skills: ["commit-commands:commit"] };
const MCP_ONLY: ClaudePlugin = { key: "context7@official", name: "context7", skills: [] };
const REVIEW: ClaudePlugin = { key: "code-review@official", name: "code-review" };
const PLUGINS = [SYNCED, COMMANDS, MCP_ONLY, REVIEW];
const ACCOUNT = ["anthropic-skills:pdf", "anthropic-skills:docx"];
const opened: Scope = { skills: ["spec"], agents: ["code-reviewer"], workflows: ["lead-waves"] };
const needed: Scope = { skills: ["spec", "code-review:code-review"], agents: ["code-reviewer"], workflows: ["lead-waves"] };
const both = { skills: true, agents: true };

describe("что спрятать из всех источников", () => {
  it("оба переключателя: свои навыки, навыки аккаунта и workflow вне открытого, агенты, плагины, ничего не дающие flow", () => {
    const hidden = hiddenOf({ catalog: CATALOG, plugins: PLUGINS, limits: both, opened, needed, accountSkills: ACCOUNT });
    expect([...hidden.skills].sort()).toEqual(["DEV1", "anthropic-skills:docx", "anthropic-skills:pdf", "deploy", "plan"]);
    expect([...hidden.agents].sort()).toEqual([...BUILTIN_AGENTS, "scout"].sort());
    expect([...hidden.plugins].sort()).toEqual(["commit-commands@official", "sales@synced"]);
    expect(hidden.bundled).toBe(true);
  });

  it("workflow открытого этапа и навык аккаунта, названный этапом, остаются видны", () => {
    const scope = { skills: ["spec", "anthropic-skills:pdf"], agents: [], workflows: ["lead-waves", "DEV1"] };
    const hidden = hiddenOf({ catalog: CATALOG, plugins: [], limits: both, opened: scope, needed: scope, accountSkills: ACCOUNT });
    expect([...hidden.skills].sort()).toEqual(["anthropic-skills:docx", "deploy", "plan"]);
  });

  it("плагин, чей навык назван этапом, остаётся, хоть его навыков и нет в каталоге bb", () => {
    const scope = { ...needed, skills: [...needed.skills, "sales:forecast"] };
    expect(hiddenOf({ catalog: CATALOG, plugins: PLUGINS, limits: both, opened, needed: scope }).plugins).not.toContain("sales@synced");
  });

  it("плагин только с MCP или хуками не трогается никогда", () => {
    expect(hiddenOf({ catalog: CATALOG, plugins: [MCP_ONLY], limits: both, opened, needed }).plugins).toEqual([]);
  });

  it("только агенты: навыки, встроенные навыки и плагины с одними навыками или командами не трогаются", () => {
    const hidden = hiddenOf({ catalog: CATALOG, plugins: PLUGINS, limits: { skills: false, agents: true }, opened, needed, accountSkills: ACCOUNT });
    expect(hidden.skills).toEqual([]);
    expect(hidden.plugins).toEqual([]);
    expect(hidden.bundled).toBe(false);
  });
});

describe("workflow этапов", () => {
  it("исполнитель-workflow этапа попадает в открытое по имени", () => {
    const stages: WorkStage[] = [{ id: "practice", name: "practice", skill: "code-standards-fp", executors: [agent("implementer"), workflow("lead-waves")] }];
    expect(scopeOf(stages, () => []).workflows).toEqual(["lead-waves"]);
  });
});

describe("встроенные навыки в файле настроек", () => {
  const ours: Hidden = { ...NOTHING_HIDDEN, bundled: true };

  it("Flow ставит disableBundledSkills и снимает его, когда переключатель выключен", () => {
    const file = mergeLocalSettings({ model: "opus" }, NOTHING_HIDDEN, ours);
    expect(file).toEqual({ model: "opus", disableBundledSkills: true });
    expect(mergeLocalSettings(file, ours, NOTHING_HIDDEN)).toEqual({ model: "opus" });
  });

  it("ключ, который владелец поставил сам, Flow не присваивает и не снимает", () => {
    const owner = { disableBundledSkills: false };
    const hidden = withoutOwnerKeys(owner, NOTHING_HIDDEN, ours);
    expect(hidden.bundled).toBe(false);
    expect(mergeLocalSettings(mergeLocalSettings(owner, NOTHING_HIDDEN, hidden), hidden, NOTHING_HIDDEN)).toEqual(owner);
  });

  it("своя прошлая запись ключа остаётся своей", () => {
    const file = mergeLocalSettings({}, NOTHING_HIDDEN, ours);
    expect(withoutOwnerKeys(file, ours, ours).bundled).toBe(true);
  });
});

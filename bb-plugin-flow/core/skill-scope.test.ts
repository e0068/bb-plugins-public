// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { FlowProgress, StageCatalog, WorkStage } from "../shared/contract";
import { agentsNamedIn, BUILTIN_AGENTS, hiddenOf, mergeLocalSettings, NOTHING_HIDDEN, openStages, scopeOf, unite, type Hidden, type Scope } from "./skill-scope";

const stage = (id: string, skill: string, extra: Partial<WorkStage> = {}): WorkStage => ({ id, name: id, skill, executors: [], ...extra });
const agent = (name: string) => ({ id: `agent:${name}`, kind: "agent" as const, name });
const workflow = (name: string) => ({ id: `workflow:${name}`, kind: "workflow" as const, name });
const progressOf = (tracks: FlowProgress["stages"]): FlowProgress => ({ stages: tracks, waiting: [] });
const done = { startedAt: "2026-10-07T10:00:00Z", finishedAt: "2026-10-07T10:05:00Z" };
const started = { startedAt: "2026-10-07T10:06:00Z" };

const STAGES: WorkStage[] = [
  stage("brief", "flow-questions"),
  stage("dod", "flow-criteria", { parent: "brief" }),
  stage("spec", "spec"),
  stage("practice", "code-standards-fp", { executors: [agent("implementer"), workflow("lead-waves")] }),
  stage("commit", "", { automation: { source: "flow", steps: [] } }),
  stage("review", "code-review", { executors: [agent("code-reviewer")] }),
];
const ids = (stages: readonly WorkStage[]) => stages.map((s) => s.id);
const noWorkflows = () => [];

describe("открытые этапы — пройденные и текущий", () => {
  it("без прогона открыт первый этап с его подэтапами", () => {
    expect(ids(openStages(STAGES, null))).toEqual(["brief", "dod"]);
  });

  it("пройденные этапы и первый незавершённый открыты, дальше — нет", () => {
    expect(ids(openStages(STAGES, progressOf({ brief: done, spec: started })))).toEqual(["brief", "dod", "spec"]);
    expect(ids(openStages(STAGES, progressOf({ brief: done, spec: done })))).toEqual(["brief", "dod", "spec", "practice"]);
  });

  it("пропущенный этап считается пройденным", () => {
    expect(ids(openStages(STAGES, progressOf({ brief: done, spec: { skipped: true } })))).toEqual(["brief", "dod", "spec", "practice"]);
  });

  it("каждый следующий отмеченный этап только добавляет открытое", () => {
    const tops = STAGES.filter((s) => s.parent === undefined);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: tops.length }), (n) => {
        const before = openStages(STAGES, progressOf(Object.fromEntries(tops.slice(0, n).map((s) => [s.id, done]))));
        const after = openStages(STAGES, progressOf(Object.fromEntries(tops.slice(0, n + 1).map((s) => [s.id, done]))));
        expect(ids(after)).toEqual(expect.arrayContaining(ids(before)));
      }),
    );
  });
});

describe("навыки и агенты этапов", () => {
  it("навык этапа, его агенты и агенты из скрипта его workflow; пустой навык автоматизации не в счёт", () => {
    const scope = scopeOf(STAGES, (id) => (id === "workflow:lead-waves" ? ["lead-planner", "implementer"] : []));
    expect([...scope.skills].sort()).toEqual(["code-review", "code-standards-fp", "flow-criteria", "flow-questions", "spec"]);
    expect([...scope.agents].sort()).toEqual(["code-reviewer", "implementer", "lead-planner"]);
  });

  it("агент из скрипта — только по имени в кавычках, не по подстроке", () => {
    const script = "agent(p, { agentType: 'implementer' })\nagent(q, { agentType: \"reviewer\" })\n// tester-ish";
    expect(agentsNamedIn(script, ["implementer", "reviewer", "tester", "review"])).toEqual(["implementer", "reviewer"]);
  });

  it("объединение не теряет ни одного имени и не повторяет их", () => {
    fc.assert(
      fc.property(fc.array(fc.string()), fc.array(fc.string()), (a, b) => {
        const united = unite({ skills: a, agents: b }, { skills: b, agents: a });
        expect(new Set(united.skills)).toEqual(new Set([...a, ...b]));
        expect(united.skills.length).toBe(new Set(united.skills).size);
      }),
    );
  });
});

const CATALOG: StageCatalog = {
  skills: [
    { name: "spec", origin: { kind: "own" } },
    { name: "plan", origin: { kind: "own" } },
    { name: "deploy", origin: { kind: "project" } },
    { name: "flow-questions", origin: { kind: "own" } },
    { name: "flow", origin: { kind: "plugin", plugin: "flow" } },
    { name: "code-review:code-review", origin: { kind: "plugin", plugin: "code-review", provider: "claude-code" } },
    { name: "sales:forecast", origin: { kind: "plugin", plugin: "sales", provider: "claude-code" } },
    { name: "codex-only", origin: { kind: "plugin", plugin: "x", provider: "codex" } },
  ],
  executors: [
    { ...agent("scout"), origin: { kind: "own" } },
    { ...agent("code-reviewer"), origin: { kind: "own" } },
    { id: "agent:pr-review-toolkit:code-reviewer", kind: "agent", name: "pr-review-toolkit:code-reviewer", origin: { kind: "plugin", plugin: "pr-review-toolkit" } },
    { id: "agent:codex/helper", kind: "agent", name: "helper" },
    workflow("lead-waves"),
  ],
};
const PLUGINS = [
  { key: "code-review@official", name: "code-review" },
  { key: "sales@other", name: "sales" },
  { key: "pr-review-toolkit@official", name: "pr-review-toolkit" },
  { key: "context7@official", name: "context7" },
];
const opened: Scope = { skills: ["spec", "flow-questions"], agents: ["code-reviewer"] };
const needed: Scope = { skills: ["spec", "flow-questions", "code-review:code-review"], agents: ["code-reviewer"] };

describe("что спрятать", () => {
  it("оба переключателя: свои навыки и агенты вне открытого, плагины, ничего не дающие flow", () => {
    const hidden = hiddenOf({ catalog: CATALOG, plugins: PLUGINS, limits: { skills: true, agents: true }, opened, needed });
    expect([...hidden.skills].sort()).toEqual(["deploy", "plan"]);
    expect([...hidden.agents].sort()).toEqual([...BUILTIN_AGENTS, "scout"].sort());
    expect([...hidden.plugins].sort()).toEqual(["pr-review-toolkit@official", "sales@other"]);
  });

  it("только навыки: агенты и плагины с агентами не трогаются", () => {
    const hidden = hiddenOf({ catalog: CATALOG, plugins: PLUGINS, limits: { skills: true, agents: false }, opened, needed });
    expect(hidden.agents).toEqual([]);
    expect(hidden.plugins).toEqual(["sales@other"]);
  });

  it("выключенные переключатели ничего не прячут", () => {
    expect(hiddenOf({ catalog: CATALOG, plugins: PLUGINS, limits: { skills: false, agents: false }, opened, needed })).toEqual(NOTHING_HIDDEN);
  });

  it("спрятанное не пересекается с открытым", () => {
    const names = fc.subarray(["spec", "plan", "deploy", "flow-questions", "scout", "code-reviewer", "Explore"]);
    fc.assert(
      fc.property(names, names, (skills, agents) => {
        const scope = { skills, agents };
        const hidden = hiddenOf({ catalog: CATALOG, plugins: PLUGINS, limits: { skills: true, agents: true }, opened: scope, needed: scope });
        expect(hidden.skills.filter((n) => skills.includes(n))).toEqual([]);
        expect(hidden.agents.filter((n) => agents.includes(n))).toEqual([]);
      }),
    );
  });
});

describe("файл настроек дерева", () => {
  const next: Hidden = { skills: ["plan"], agents: ["scout"], plugins: ["sales@other"] };

  it("записи Flow ложатся рядом с ключами владельца", () => {
    const current = { model: "opus", skillOverrides: { legacy: "name-only" }, permissions: { allow: ["Bash(ls)"], deny: ["Bash(rm *)"] } };
    expect(mergeLocalSettings(current, NOTHING_HIDDEN, next)).toEqual({
      model: "opus",
      skillOverrides: { legacy: "name-only", plan: "off" },
      permissions: { allow: ["Bash(ls)"], deny: ["Bash(rm *)", "Agent(scout)"] },
      enabledPlugins: { "sales@other": false },
    });
  });

  it("снятые записи уходят, пустые разделы не остаются", () => {
    expect(mergeLocalSettings(mergeLocalSettings({}, NOTHING_HIDDEN, next), next, NOTHING_HIDDEN)).toEqual({});
  });

  it("ключи владельца переживают любую последовательность записей Flow", () => {
    const hiddenArb = fc.record({ skills: fc.subarray(["a", "b", "c"]), agents: fc.subarray(["x", "y"]), plugins: fc.subarray(["p@m", "q@m"]) });
    const owner = { model: "opus", skillOverrides: { mine: "off" }, permissions: { deny: ["Bash(rm *)"] }, enabledPlugins: { "own@m": true } };
    fc.assert(
      fc.property(fc.array(hiddenArb, { maxLength: 5 }), (writes) => {
        const [last, file] = writes.reduce<[Hidden, Record<string, unknown>]>(([previous, acc], hidden) => [hidden, mergeLocalSettings(acc, previous, hidden)], [NOTHING_HIDDEN, owner]);
        expect(mergeLocalSettings(file, last, NOTHING_HIDDEN)).toEqual(owner);
      }),
    );
  });
});

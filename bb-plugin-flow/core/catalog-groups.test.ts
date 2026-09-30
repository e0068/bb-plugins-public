// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { StageCatalog, StageExecutor } from "../shared/contract";
import { executorGroups, installedPluginDirs, parseCodexAgentFile, skillGroups, skillOrigin, skillShortName } from "./catalog";

type Skill = StageCatalog["skills"][number];

const own: Skill = { name: "spec", origin: { kind: "own" } };
const legacy: Skill = { name: "plan" };
const project: Skill = { name: "release-notes", origin: { kind: "project" } };
const flow: Skill = { name: "flow-demo", origin: { kind: "plugin", plugin: "flow" } };
const tasks: Skill = { name: "tasks", origin: { kind: "plugin", plugin: "tasks-plus" } };
const figma: Skill = { name: "figma:figma-use", origin: { kind: "plugin", plugin: "figma", provider: "claude-code" } };
const engineering: Skill = { name: "engineering:debug", origin: { kind: "plugin", plugin: "engineering", provider: "codex" } };

describe("откуда навык", () => {
  it("свои, общие и встроенные навыки — свои; навыки проекта — проекта", () => {
    for (const scope of ["bb-user", "provider-user", "shared-user", "bb-builtin"] as const) expect(skillOrigin({ scope, pluginId: null, provider: "claude-code" })).toEqual({ kind: "own" });
    for (const scope of ["bb-project", "provider-project", "shared-project"] as const) expect(skillOrigin({ scope, pluginId: null, provider: null })).toEqual({ kind: "project" });
  });

  it("навык плагина — плагин по его id, у плагина провайдера — ещё и провайдер", () => {
    expect(skillOrigin({ scope: "plugin", pluginId: "flow", provider: null })).toEqual({ kind: "plugin", plugin: "flow" });
    expect(skillOrigin({ scope: "plugin", pluginId: "figma", provider: "claude-code" })).toEqual({ kind: "plugin", plugin: "figma", provider: "claude-code" });
  });

  it("источник не назвал область — навык свой", () => {
    expect(skillOrigin({})).toEqual({ kind: "own" });
  });
});

describe("группы навыков в списке выбора", () => {
  it("свои, проекта, плагины bb по имени, потом плагины провайдеров по провайдеру и имени", () => {
    const groups = skillGroups([engineering, figma, tasks, flow, project, own, legacy]);
    expect(groups.map((g) => g.origin)).toEqual([
      { kind: "own" },
      { kind: "project" },
      { kind: "plugin", plugin: "flow" },
      { kind: "plugin", plugin: "tasks-plus" },
      { kind: "plugin", plugin: "figma", provider: "claude-code" },
      { kind: "plugin", plugin: "engineering", provider: "codex" },
    ]);
  });

  it("навык без источника попадает в свои; каждый навык ровно в одной группе, внутри — по имени", () => {
    const groups = skillGroups([engineering, own, legacy, figma]);
    expect(groups[0]!.skills.map((s) => s.name)).toEqual(["plan", "spec"]);
    expect(groups.flatMap((g) => g.skills)).toHaveLength(4);
  });

  it("пустой каталог — нет групп", () => {
    expect(skillGroups([])).toEqual([]);
  });

  it("в строке навыка плагина провайдера префикс плагина снят; у остальных имя как есть", () => {
    expect(skillShortName(figma)).toBe("figma-use");
    expect(skillShortName(engineering)).toBe("debug");
    expect(skillShortName(flow)).toBe("flow-demo");
    expect(skillShortName({ name: "other:thing", origin: { kind: "plugin", plugin: "figma", provider: "codex" } })).toBe("other:thing");
  });
});

const agent = (name: string, patch: Partial<StageExecutor> = {}): StageExecutor => ({ id: `agent:${name}`, kind: "agent", name, provider: "claude-code", ...patch });

describe("группы исполнителей в меню", () => {
  it("мои, проекты, плагины, Codex, workflow — по порядку", () => {
    const groups = executorGroups([
      { id: "workflow:DEV1", kind: "workflow", name: "DEV1" },
      agent("coder", { provider: "codex", origin: { kind: "own" } }),
      agent("cm:critic", { origin: { kind: "plugin", plugin: "cm" } }),
      agent("scout", { origin: { kind: "project", project: "bb-plugins" } }),
      agent("reviewer"),
    ]);
    expect(groups.map((g) => g.group)).toEqual([{ kind: "own" }, { kind: "project", project: "bb-plugins" }, { kind: "plugin", plugin: "cm" }, { kind: "codex" }, { kind: "workflow" }]);
  });

  it("агенты одного проекта или плагина — одна группа; пустых групп нет", () => {
    const groups = executorGroups([agent("a", { origin: { kind: "project", project: "p" } }), agent("b", { origin: { kind: "project", project: "p" } })]);
    expect(groups).toEqual([{ group: { kind: "project", project: "p" }, executors: [expect.objectContaining({ name: "a" }), expect.objectContaining({ name: "b" })] }]);
  });
});

describe("агент Codex из toml", () => {
  it("имя, описание и модель из верхних строк файла; поставщик — codex, id отдельный от одноимённого агента Claude Code", () => {
    const file = 'name = "code-reviewer"\ndescription = "Ревьюер: \\"строгий\\""\nmodel = "gpt-5.5"\ndeveloper_instructions = """\nname = "подмена"\n"""\n';
    expect(parseCodexAgentFile(file)).toEqual({ id: "agent:codex/code-reviewer", kind: "agent", name: "code-reviewer", description: 'Ревьюер: "строгий"', model: "gpt-5.5", provider: "codex" });
  });

  it("без имени — не агент", () => {
    expect(parseCodexAgentFile('description = "без имени"')).toBeNull();
    expect(parseCodexAgentFile("")).toBeNull();
  });
});

describe("установленные плагины Claude Code", () => {
  const installed = JSON.stringify({ version: 2, plugins: { "figma@official": [{ installPath: "/p/figma/2.0" }], "cm@market": [{ installPath: "/p/cm/1.0" }], "off@market": [{ installPath: "/p/off/1.0" }] } });

  it("папка каждого плагина с его именем; выключенный в настройках — не берётся", () => {
    expect(installedPluginDirs(installed, JSON.stringify({ enabledPlugins: { "off@market": false, "cm@market": true } }))).toEqual([
      { plugin: "figma", dir: "/p/figma/2.0" },
      { plugin: "cm", dir: "/p/cm/1.0" },
    ]);
  });

  it("настроек нет или они битые — берутся все; битый список плагинов — ни одного", () => {
    expect(installedPluginDirs(installed, null).map((p) => p.plugin)).toEqual(["figma", "cm", "off"]);
    expect(installedPluginDirs(installed, "{").map((p) => p.plugin)).toEqual(["figma", "cm", "off"]);
    expect(installedPluginDirs("мусор", null)).toEqual([]);
    expect(installedPluginDirs(JSON.stringify({ plugins: { "x@m": "не список" } }), null)).toEqual([]);
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";

import { readStageCatalog, type CatalogSources } from "./stage-catalog";

const agentFile = (name: string, model = "opus") => `---\nname: ${name}\nmodel: ${model}\n---\n`;

const files: Record<string, string> = {
  "/home/owner/.claude/agents/reviewer.md": agentFile("reviewer"),
  "/home/owner/.claude/agents/team/tester.md": agentFile("tester", "haiku"),
  "/home/owner/.claude/agents/team/deep/nested.md": agentFile("nested"),
  "/work/bb-plugins/.claude/agents/scout.md": agentFile("scout", "haiku"),
  "/work/other/.claude/agents/scout.md": agentFile("scout"),
  "/home/owner/.claude/plugins/installed_plugins.json": JSON.stringify({ plugins: { "cm@market": [{ installPath: "/cache/cm/1.0" }], "off@market": [{ installPath: "/cache/off/1.0" }] } }),
  "/home/owner/.claude/settings.json": JSON.stringify({ enabledPlugins: { "off@market": false } }),
  "/cache/cm/1.0/agents/critic.md": agentFile("critic"),
  "/cache/off/1.0/agents/hidden.md": agentFile("hidden"),
  "/home/owner/.codex/agents/coder.toml": 'name = "coder"\nmodel = "gpt-5.5"\n',
  "/home/owner/.codex/agents/reviewer.toml": 'name = "reviewer"\n',
};

const listDir = async (dir: string): Promise<string[]> => {
  const prefix = `${dir}/`;
  const names = Object.keys(files).filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length).split("/")[0]!);
  if (names.length === 0) throw new Error(`ENOENT ${dir}`);
  return [...new Set(names)];
};

const sources = (patch: Partial<CatalogSources> = {}): CatalogSources => ({
  projectIds: async () => [],
  skills: async () => [],
  listDir,
  readFile: async (path) => {
    const text = files[path];
    if (text === undefined) throw new Error(`ENOENT ${path}`);
    return text;
  },
  home: "/home/owner",
  projects: async () => [
    { name: "bb-plugins", path: "/work/bb-plugins" },
    { name: "other", path: "/work/other" },
  ],
  ...patch,
});

describe("агенты исполнителей из всех мест", () => {
  it("свои агенты — и из подпапок ~/.claude/agents", async () => {
    const { executors } = await readStageCatalog(sources());
    const own = executors.filter((e) => e.provider === "claude-code" && e.origin?.kind === "own").map((e) => e.name);
    expect(own).toEqual(expect.arrayContaining(["reviewer", "tester", "nested"]));
  });

  it("агенты .claude/agents проектов bb — с именем проекта; одноимённый агент второго проекта не дублирует первого", async () => {
    const { executors } = await readStageCatalog(sources());
    expect(executors.filter((e) => e.name === "scout")).toEqual([expect.objectContaining({ id: "agent:scout", provider: "claude-code", origin: { kind: "project", project: "bb-plugins" } })]);
  });

  it("агенты включённых плагинов Claude Code — с префиксом плагина", async () => {
    const { executors } = await readStageCatalog(sources());
    expect(executors.find((e) => e.origin?.kind === "plugin")).toEqual(expect.objectContaining({ id: "agent:cm:critic", name: "cm:critic", provider: "claude-code", origin: { kind: "plugin", plugin: "cm" } }));
    expect(executors.some((e) => e.name.includes("hidden"))).toBe(false);
  });

  it("агенты Codex из ~/.codex/agents — с поставщиком codex и своим id, одноимённый агент Claude Code остаётся", async () => {
    const { executors } = await readStageCatalog(sources());
    expect(executors.filter((e) => e.provider === "codex").map((e) => [e.id, e.name])).toEqual([
      ["agent:codex/coder", "coder"],
      ["agent:codex/reviewer", "reviewer"],
    ]);
    expect(executors.filter((e) => e.id === "agent:reviewer").map((e) => e.provider)).toEqual(["claude-code"]);
  });

  it("нет ни проектов, ни плагинов, ни Codex — только свои агенты, без ошибки", async () => {
    const bare = await readStageCatalog(sources({ projects: undefined, listDir: async (dir) => (dir === "/home/owner/.claude/agents" ? ["reviewer.md"] : Promise.reject(new Error("нет"))) }));
    expect(bare.executors.map((e) => e.id)).toEqual(["agent:reviewer"]);
  });
});

describe("навыки каталога знают, откуда они", () => {
  it("область и плагин из bb становятся источником навыка", async () => {
    const { skills } = await readStageCatalog(
      sources({
        projectIds: async () => ["prj_1"],
        skills: async () => [
          { name: "spec", description: null, scope: "provider-user", pluginId: null, provider: "claude-code" },
          { name: "figma:figma-use", description: "Figma", scope: "plugin", pluginId: "figma", provider: "claude-code" },
          { name: "flow-demo", description: null, scope: "plugin", pluginId: "flow", provider: null },
        ],
      }),
    );
    expect(skills).toEqual([
      { name: "figma:figma-use", description: "Figma", origin: { kind: "plugin", plugin: "figma", provider: "claude-code" } },
      { name: "flow-demo", origin: { kind: "plugin", plugin: "flow" } },
      { name: "spec", origin: { kind: "own" } },
    ]);
  });
});

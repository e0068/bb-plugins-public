// @vitest-environment node
// Плагины Claude Code для решения, что выключить: установленные — с навыками и командами из их папок,
// синхронизированные с claude.ai — с ключом `имя@synced`, — и навыки аккаунта claude.ai.
import { describe, expect, it } from "vitest";

import { readAccountSkills, readClaudePlugins, type CatalogSources } from "./stage-catalog";

const SYNCED = "/home/owner/.claude/plugins/synced/acc1";

const files: Record<string, string> = {
  "/home/owner/.claude/plugins/installed_plugins.json": JSON.stringify({
    plugins: { "cmds@official": [{ installPath: "/cache/cmds/1.0" }], "mcp@official": [{ installPath: "/cache/mcp/1.0" }], "skilled@official": [{ installPath: "/cache/skilled/1.0" }] },
  }),
  "/home/owner/.claude/settings.json": JSON.stringify({ enabledPlugins: { "legal@synced": false } }),
  "/cache/cmds/1.0/commands/commit.md": "# commit",
  "/cache/cmds/1.0/commands/README.txt": "not a command",
  "/cache/mcp/1.0/.mcp.json": "{}",
  "/cache/skilled/1.0/skills/review/SKILL.md": "---\nname: review\n---\n",
  [`${SYNCED}/manifest.json`]: "{}",
  [`${SYNCED}/sales~g2/.claude-plugin/plugin.json`]: JSON.stringify({ name: "sales" }),
  [`${SYNCED}/sales~g2/skills/forecast/SKILL.md`]: "x",
  [`${SYNCED}/sales~g2/skills/call-prep/SKILL.md`]: "x",
  [`${SYNCED}/figma/skills/figma-use/SKILL.md`]: "x",
  [`${SYNCED}/figma~g3/skills/figma-shaders/SKILL.md`]: "x",
  [`${SYNCED}/legal~g2/skills/brief/SKILL.md`]: "x",
  "/home/owner/.claude/skills/synced/acc1/pdf/SKILL.md": "x",
  "/home/owner/.claude/skills/synced/acc1/manifest.json": "{}",
  "/home/owner/.claude/skills/synced/acc2/pdf/SKILL.md": "x",
  "/home/owner/.claude/skills/synced/acc2/docx/SKILL.md": "x",
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
  ...patch,
});

describe("плагины Claude Code для выключения", () => {
  it("установленный плагин несёт навыки из skills/ и команды из commands/ под своим именем; плагин с одним MCP — ничего", async () => {
    const plugins = await readClaudePlugins(sources());
    expect(plugins.find((p) => p.key === "cmds@official")).toEqual({ key: "cmds@official", name: "cmds", skills: ["cmds:commit"] });
    expect(plugins.find((p) => p.key === "skilled@official")?.skills).toEqual(["skilled:review"]);
    expect(plugins.find((p) => p.key === "mcp@official")?.skills).toEqual([]);
  });

  it("синхронизированный с claude.ai плагин — с ключом имя@synced; поколения одной папки сливаются, выключенный владельцем не берётся", async () => {
    const synced = (await readClaudePlugins(sources())).filter((p) => p.key.endsWith("@synced"));
    expect(synced.map((p) => p.key).sort()).toEqual(["figma@synced", "sales@synced"]);
    expect([...(synced.find((p) => p.name === "sales")?.skills ?? [])].sort()).toEqual(["sales:call-prep", "sales:forecast"]);
    expect([...(synced.find((p) => p.name === "figma")?.skills ?? [])].sort()).toEqual(["figma:figma-shaders", "figma:figma-use"]);
  });

  it("нет папок плагинов — нет и плагинов, без сбоя", async () => {
    expect(await readClaudePlugins(sources({ listDir: async () => Promise.reject(new Error("ENOENT")), readFile: async () => Promise.reject(new Error("ENOENT")) }))).toEqual([]);
  });
});

describe("навыки аккаунта claude.ai", () => {
  it("навыки всех аккаунтов по одному разу, под именем anthropic-skills", async () => {
    expect(await readAccountSkills(sources())).toEqual(["anthropic-skills:docx", "anthropic-skills:pdf"]);
  });

  it("папки нет — навыков нет", async () => {
    expect(await readAccountSkills(sources({ listDir: async () => Promise.reject(new Error("ENOENT")) }))).toEqual([]);
  });
});

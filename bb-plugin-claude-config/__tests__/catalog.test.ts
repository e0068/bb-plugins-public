import { describe, expect, it } from "vitest";

import {
  collectAgentNames,
  collectSkillNames,
  mergeAgents,
  mergeSkills,
  parseClaudeJsonServers,
  parseInstalledPlugins,
  parseMcpJson,
  transportOf,
} from "../src/catalog";

describe("parseInstalledPlugins", () => {
  const text = JSON.stringify({
    version: 2,
    plugins: {
      "figma@claude-plugins-official": [{ scope: "user", version: "2.2.90" }],
      "telegram@claude-plugins-official": [{ scope: "user", version: "0.0.6" }],
    },
  });

  it("splits the key into name and marketplace", () => {
    const [figma] = parseInstalledPlugins(text);
    expect(figma).toEqual({
      key: "figma@claude-plugins-official",
      name: "figma",
      marketplace: "claude-plugins-official",
      version: "2.2.90",
      installPath: null,
    });
  });

  it("doesn't throw on a missing or corrupted file", () => {
    expect(parseInstalledPlugins(null)).toEqual([]);
    expect(parseInstalledPlugins("{ broken")).toEqual([]);
    expect(parseInstalledPlugins("[]")).toEqual([]);
    expect(parseInstalledPlugins('{"version":2}')).toEqual([]);
  });

  it("survives an installation without a version", () => {
    const noVersion = parseInstalledPlugins('{"plugins":{"a@m":[]}}');
    expect(noVersion[0]).toMatchObject({ key: "a@m", version: null });
  });

  it("takes installPath from the installation", () => {
    const withPath = parseInstalledPlugins(
      '{"plugins":{"a@m":[{"installPath":"/p/a/1.0"}]}}',
    );
    expect(withPath[0]).toMatchObject({ installPath: "/p/a/1.0" });
  });

  it("a key without a marketplace stays the name in full", () => {
    expect(parseInstalledPlugins('{"plugins":{"local":[{}]}}')[0]).toMatchObject(
      { name: "local", marketplace: "" },
    );
  });
});

describe("collectSkillNames", () => {
  it("takes the name of the directory that holds SKILL.md", () => {
    expect(
      collectSkillNames([
        "preflight/SKILL.md",
        "preflight/references/checks.md",
        "git-hygiene/SKILL.md",
      ]),
    ).toEqual(["git-hygiene", "preflight"]);
  });

  it("unwraps the synced service directory", () => {
    expect(collectSkillNames(["synced/pdf-tools/SKILL.md"])).toEqual([
      "pdf-tools",
    ]);
  });

  it("skips anything that isn't SKILL.md at its own level", () => {
    expect(
      collectSkillNames([
        "README.md",
        "SKILL.md",
        "a/b/c/SKILL.md",
        "notes/deep/SKILL.md",
      ]),
    ).toEqual([]);
  });
});

describe("mergeSkills", () => {
  it("marks origin and sorts by name", () => {
    expect(mergeSkills(["preflight"], ["deploy"])).toEqual([
      { name: "deploy", origin: "project" },
      { name: "preflight", origin: "personal" },
    ]);
  });

  it("a project skill with the same name overrides the personal one", () => {
    expect(mergeSkills(["deploy"], ["deploy"])).toEqual([
      { name: "deploy", origin: "project" },
    ]);
  });
});

describe("collectAgentNames", () => {
  it("takes the .md file name without the extension", () => {
    expect(collectAgentNames(["reviewer.md", "planner.md"])).toEqual([
      "planner",
      "reviewer",
    ]);
  });

  it("skips nested paths and non-.md files", () => {
    expect(
      collectAgentNames(["reviewer.md", "sub/nested.md", "README.txt"]),
    ).toEqual(["reviewer"]);
  });
});

describe("mergeAgents", () => {
  it("marks origin, project overrides personal", () => {
    expect(mergeAgents(["reviewer"], ["reviewer", "deploy"])).toEqual([
      { name: "deploy", origin: "project" },
      { name: "reviewer", origin: "project" },
    ]);
  });
});

describe("transportOf", () => {
  it("takes an explicit type, otherwise infers it from url/command", () => {
    expect(transportOf({ type: "sse" })).toBe("sse");
    expect(transportOf({ url: "https://x" })).toBe("http");
    expect(transportOf({ command: "uvx" })).toBe("stdio");
    expect(transportOf({})).toBe("");
    expect(transportOf(null)).toBe("");
  });
});

describe("parseMcpJson", () => {
  it("parses mcpServers and sorts by name", () => {
    const text = JSON.stringify({
      mcpServers: {
        serena: { type: "stdio", command: "uvx" },
        linear: { url: "https://mcp.linear.app" },
      },
    });
    expect(parseMcpJson(text)).toEqual([
      { name: "linear", transport: "http", config: { url: "https://mcp.linear.app" } },
      { name: "serena", transport: "stdio", config: { type: "stdio", command: "uvx" } },
    ]);
  });

  it("no file or an unrecognized shape — empty list", () => {
    expect(parseMcpJson(null)).toEqual([]);
    expect(parseMcpJson("{ broken")).toEqual([]);
    expect(parseMcpJson("{}")).toEqual([]);
  });
});

describe("parseClaudeJsonServers", () => {
  const text = JSON.stringify({
    mcpServers: { context7: { url: "https://c7" } },
    projects: {
      "/repo": { mcpServers: { serena: { command: "uvx" } } },
      "/other": { mcpServers: { foo: { command: "x" } } },
    },
  });

  it("splits into user (top level) and local (by project root)", () => {
    const { user, local } = parseClaudeJsonServers(text, "/repo");
    expect(user).toEqual([
      { name: "context7", transport: "http", config: { url: "https://c7" } },
    ]);
    expect(local).toEqual([
      { name: "serena", transport: "stdio", config: { command: "uvx" } },
    ]);
  });

  it("without a project root, local is empty", () => {
    expect(parseClaudeJsonServers(text, null).local).toEqual([]);
  });

  it("root matching tolerates a trailing slash", () => {
    // Key in the file has no slash, root from bb has one — the server is still found.
    expect(parseClaudeJsonServers(text, "/repo/").local).toEqual([
      { name: "serena", transport: "stdio", config: { command: "uvx" } },
    ]);
  });

  it("no file — both lists are empty", () => {
    expect(parseClaudeJsonServers(null, "/repo")).toEqual({ user: [], local: [] });
  });
});

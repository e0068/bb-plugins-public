import { describe, expect, it } from "vitest";

import { buildConfigView, type ViewInput } from "../src/config-view";

const installed = JSON.stringify({
  version: 2,
  plugins: {
    "figma@official": [{ scope: "user", version: "2.2.90" }],
    "telegram@official": [{ scope: "user", version: "0.0.6" }],
  },
});

function input(overrides: Partial<ViewInput>): ViewInput {
  return {
    areaKind: "global",
    editedDoc: {},
    levelDocs: [{}],
    installedPluginsText: installed,
    personalSkillPaths: [],
    projectSkillPaths: [],
    personalAgentDir: "/home/u/.claude/agents",
    projectAgentDir: null,
    personalAgentPaths: [],
    projectAgentPaths: [],
    mcpJsonText: null,
    claudeJsonText: null,
    projectRoot: null,
    levelOrigins: ["user"],
    disabledHooksByLevel: [],
    ...overrides,
  };
}

describe("buildConfigView — plugins", () => {
  it("globally: on/off switch, no dimming", () => {
    const view = buildConfigView(
      input({
        editedDoc: { enabledPlugins: { "figma@official": true } },
        levelDocs: [{ enabledPlugins: { "figma@official": true } }],
      }),
    );
    expect(view.plugins).toEqual([
      {
        key: "figma@official",
        name: "figma",
        marketplace: "official",
        version: "2.2.90",
        value: true,
        dimmed: false,
        installPath: null,
      },
      {
        key: "telegram@official",
        name: "telegram",
        marketplace: "official",
        version: "0.0.6",
        value: false,
        dimmed: false,
        installPath: null,
      },
    ]);
  });

  it("project: a row matching the global value is dimmed", () => {
    // figma is enabled both globally and in the project (matches) → dimmed;
    // telegram is off globally, on locally (differs) → not dimmed.
    const view = buildConfigView(
      input({
        areaKind: "project",
        editedDoc: { enabledPlugins: { "telegram@official": true } },
        levelDocs: [
          { enabledPlugins: { "figma@official": true } },
          {},
          { enabledPlugins: { "telegram@official": true } },
        ],
      }),
    );
    expect(view.plugins.find((p) => p.key === "figma@official")).toMatchObject({
      value: true,
      dimmed: true,
    });
    expect(
      view.plugins.find((p) => p.key === "telegram@official"),
    ).toMatchObject({ value: true, dimmed: false });
  });

  it("project: a local toggle over a globally enabled value — differs", () => {
    const view = buildConfigView(
      input({
        areaKind: "project",
        editedDoc: { enabledPlugins: { "figma@official": false } },
        levelDocs: [
          { enabledPlugins: { "figma@official": true } },
          {},
          { enabledPlugins: { "figma@official": false } },
        ],
      }),
    );
    expect(view.plugins.find((p) => p.key === "figma@official")).toMatchObject({
      value: false,
      dimmed: false,
    });
  });

  it("shows the key from settings even when it's no longer installed", () => {
    const view = buildConfigView(
      input({
        installedPluginsText: null,
        editedDoc: { enabledPlugins: { "gone@m": false } },
        levelDocs: [{ enabledPlugins: { "gone@m": false } }],
      }),
    );
    expect(view.plugins).toEqual([
      {
        key: "gone@m",
        name: "gone",
        marketplace: "m",
        version: null,
        value: false,
        dimmed: false,
        installPath: null,
      },
    ]);
  });
});

describe("buildConfigView — agents", () => {
  it("builds the path from the directory and name, project overrides personal", () => {
    const view = buildConfigView(
      input({
        areaKind: "project",
        levelDocs: [{}, {}, {}],
        levelOrigins: ["user", "project", "local"],
        personalAgentDir: "/home/u/.claude/agents",
        projectAgentDir: "/proj/.claude/agents",
        personalAgentPaths: ["reviewer.md", "planner.md"],
        projectAgentPaths: ["reviewer.md"],
      }),
    );
    expect(view.agents).toEqual([
      {
        name: "planner",
        origin: "personal",
        path: "/home/u/.claude/agents/planner.md",
      },
      {
        name: "reviewer",
        origin: "project",
        path: "/proj/.claude/agents/reviewer.md",
      },
    ]);
  });

  it("no files — the list is empty", () => {
    expect(buildConfigView(input({})).agents).toEqual([]);
  });
});

describe("buildConfigView — skills", () => {
  it("a skill is enabled and full by default", () => {
    const view = buildConfigView(
      input({
        personalSkillPaths: ["preflight/SKILL.md"],
        projectSkillPaths: ["deploy/SKILL.md"],
      }),
    );
    expect(view.skills).toEqual([
      { name: "deploy", origin: "project", enabled: true, mode: "on", dimmed: false },
      {
        name: "preflight",
        origin: "personal",
        enabled: true,
        mode: "on",
        dimmed: false,
      },
    ]);
  });

  it("mode is resolved across levels, turning off gives enabled=false", () => {
    const view = buildConfigView(
      input({
        personalSkillPaths: ["a/SKILL.md", "b/SKILL.md"],
        editedDoc: { skillOverrides: { a: "off" } },
        levelDocs: [
          { skillOverrides: { a: "name-only", b: "name-only" } },
          {},
          { skillOverrides: { a: "off" } },
        ],
      }),
    );
    // a is turned off at the narrow level; b stays name-only.
    expect(view.skills.find((s) => s.name === "a")).toMatchObject({
      enabled: false,
      mode: "on",
    });
    expect(view.skills.find((s) => s.name === "b")).toMatchObject({
      enabled: true,
      mode: "name-only",
    });
  });

  it("project: a mode matching the global value dims the row", () => {
    // preflight: name-only globally, name-only in the project too → dimmed;
    // deploy: on globally, off locally → differs, not dimmed.
    const view = buildConfigView(
      input({
        areaKind: "project",
        personalSkillPaths: ["preflight/SKILL.md"],
        projectSkillPaths: ["deploy/SKILL.md"],
        editedDoc: { skillOverrides: { deploy: "off" } },
        levelDocs: [
          { skillOverrides: { preflight: "name-only" } },
          {},
          { skillOverrides: { deploy: "off" } },
        ],
      }),
    );
    expect(view.skills.find((s) => s.name === "preflight")).toMatchObject({
      enabled: true,
      mode: "name-only",
      dimmed: true,
    });
    expect(view.skills.find((s) => s.name === "deploy")).toMatchObject({
      enabled: false,
      dimmed: false,
    });
  });

  it("an override left over from a removed skill shows as personal", () => {
    const view = buildConfigView(
      input({
        editedDoc: { skillOverrides: { ghost: "off" } },
        levelDocs: [{ skillOverrides: { ghost: "off" } }],
      }),
    );
    expect(view.skills).toEqual([
      {
        name: "ghost",
        origin: "personal",
        enabled: false,
        mode: "on",
        dimmed: false,
      },
    ]);
  });
});

const mcpJson = JSON.stringify({
  mcpServers: {
    serena: { type: "stdio", command: "uvx", args: ["serena"] },
    linear: { type: "http", url: "https://mcp.linear.app" },
  },
});

const claudeJson = JSON.stringify({
  mcpServers: { context7: { type: "http", url: "https://c7" } },
  projects: {
    "/repo": { mcpServers: { serena: { type: "stdio", command: "uvx" } } },
  },
});

describe("buildConfigView — connectors", () => {
  it(".mcp.json servers: toggleable, off by default (approval needed)", () => {
    const view = buildConfigView(input({ mcpJsonText: mcpJson }));
    expect(view.connectors).toEqual([
      {
        name: "linear",
        origin: "mcpjson",
        transport: "http",
        toggleable: true,
        value: false,
        dimmed: false,
      },
      {
        name: "serena",
        origin: "mcpjson",
        transport: "stdio",
        toggleable: true,
        value: false,
        dimmed: false,
      },
    ]);
  });

  it("a server in enabledMcpjsonServers is on; in disabled it's off", () => {
    const view = buildConfigView(
      input({
        mcpJsonText: mcpJson,
        levelDocs: [
          {
            enabledMcpjsonServers: ["serena"],
            disabledMcpjsonServers: ["linear"],
          },
        ],
      }),
    );
    expect(view.connectors.find((c) => c.name === "serena")).toMatchObject({
      value: true,
    });
    expect(view.connectors.find((c) => c.name === "linear")).toMatchObject({
      value: false,
    });
  });

  it("enableAllProjectMcpServers turns on servers that aren't mentioned", () => {
    const view = buildConfigView(
      input({
        mcpJsonText: mcpJson,
        levelDocs: [
          {
            enableAllProjectMcpServers: true,
            disabledMcpjsonServers: ["linear"],
          },
        ],
      }),
    );
    // serena isn't mentioned → enabled via enableAll; linear is explicitly denied.
    expect(view.connectors.find((c) => c.name === "serena")).toMatchObject({
      value: true,
    });
    expect(view.connectors.find((c) => c.name === "linear")).toMatchObject({
      value: false,
    });
  });

  it("user and local servers from ~/.claude.json — read-only", () => {
    const view = buildConfigView(
      input({
        areaKind: "project",
        levelDocs: [{}, {}, {}],
        levelOrigins: ["user", "project", "local"],
        claudeJsonText: claudeJson,
        projectRoot: "/repo",
      }),
    );
    expect(view.connectors).toEqual([
      {
        name: "context7",
        origin: "user",
        transport: "http",
        toggleable: false,
        value: true,
        dimmed: false,
      },
      {
        name: "serena",
        origin: "local",
        transport: "stdio",
        toggleable: false,
        value: true,
        dimmed: false,
      },
    ]);
  });

  it("project: a .mcp.json server matching the global value is dimmed", () => {
    // Enabled at the user level; not overridden in the project → matches → dimmed.
    const view = buildConfigView(
      input({
        areaKind: "project",
        mcpJsonText: mcpJson,
        levelOrigins: ["user", "project", "local"],
        levelDocs: [{ enabledMcpjsonServers: ["serena"] }, {}, {}],
      }),
    );
    expect(view.connectors.find((c) => c.name === "serena")).toMatchObject({
      value: true,
      dimmed: true,
    });
  });
});

describe("buildConfigView — hooks", () => {
  it("lists hooks across levels with their origin", () => {
    const view = buildConfigView(
      input({
        areaKind: "project",
        levelOrigins: ["user", "project", "local"],
        levelDocs: [
          {
            hooks: {
              UserPromptSubmit: [
                { hooks: [{ type: "command", command: "cat checklist" }] },
              ],
            },
          },
          {
            hooks: {
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [{ type: "command", command: "lint" }],
                },
              ],
            },
          },
          {},
        ],
      }),
    );
    expect(view.hooks).toEqual([
      {
        event: "UserPromptSubmit",
        matcher: null,
        command: "cat checklist",
        origin: "user",
        index: 0,
        enabled: true,
      },
      {
        event: "PreToolUse",
        matcher: "Bash",
        command: "lint",
        origin: "project",
        index: 0,
        enabled: true,
      },
    ]);
  });

  it("no hooks — empty list", () => {
    expect(buildConfigView(input({})).hooks).toEqual([]);
  });

  it("a level's disabled hooks come after active ones, index:-1, enabled:false", () => {
    const view = buildConfigView(
      input({
        areaKind: "project",
        levelOrigins: ["user", "project", "local"],
        levelDocs: [
          {
            hooks: {
              PreToolUse: [
                { matcher: "Bash", hooks: [{ type: "command", command: "lint" }] },
              ],
            },
          },
          {},
          {},
        ],
        disabledHooksByLevel: [
          [{ event: "Stop", matcher: null, command: "notify" }],
          [],
          [],
        ],
      }),
    );
    expect(view.hooks).toEqual([
      {
        event: "PreToolUse",
        matcher: "Bash",
        command: "lint",
        origin: "user",
        index: 0,
        enabled: true,
      },
      {
        event: "Stop",
        matcher: null,
        command: "notify",
        origin: "user",
        index: -1,
        enabled: false,
      },
    ]);
  });

  it("an empty disabledHooksByLevel (including shorter than levelDocs) doesn't break the build", () => {
    const view = buildConfigView(
      input({
        levelDocs: [{}, {}],
        levelOrigins: ["user", "project"],
        disabledHooksByLevel: [],
      }),
    );
    expect(view.hooks).toEqual([]);
  });
});

describe("buildConfigView — tool search", () => {
  it("is enabled by default in auto mode", () => {
    const view = buildConfigView(input({}));
    expect(view.toolSearch).toEqual({
      enabled: true,
      mode: "auto",
      dimmed: false,
    });
  });

  it("a narrower level overrides a wider one (turning off)", () => {
    const view = buildConfigView(
      input({
        editedDoc: { env: { ENABLE_TOOL_SEARCH: "false" } },
        levelDocs: [
          { env: { ENABLE_TOOL_SEARCH: "true" } },
          {},
          { env: { ENABLE_TOOL_SEARCH: "false" } },
        ],
      }),
    );
    expect(view.toolSearch).toMatchObject({ enabled: false, mode: "auto" });
  });

  it("project: a mode matching the global value dims the row", () => {
    const view = buildConfigView(
      input({
        areaKind: "project",
        levelDocs: [
          { env: { ENABLE_TOOL_SEARCH: "true" } },
          {},
          { env: { ENABLE_TOOL_SEARCH: "true" } },
        ],
      }),
    );
    expect(view.toolSearch).toEqual({
      enabled: true,
      mode: "on",
      dimmed: true,
    });
  });
});

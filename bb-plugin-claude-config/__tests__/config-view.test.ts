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
    mcpJsonText: null,
    claudeJsonText: null,
    projectRoot: null,
    levelOrigins: ["user"],
    disabledHooksByLevel: [],
    ...overrides,
  };
}

describe("buildConfigView — плагины", () => {
  it("глобально: свитч вкл/выкл, без гашения", () => {
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

  it("проект: строка, совпадающая с глобальным, гасится", () => {
    // figma включён и глобально, и в проекте (совпадает) → dimmed;
    // telegram глобально выкл, локально вкл (отличается) → не dimmed.
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

  it("проект: локальный выключатель поверх глобально включённого — отличие", () => {
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

  it("показывает ключ из настроек, даже когда он уже не установлен", () => {
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

describe("buildConfigView — навыки", () => {
  it("по умолчанию навык включён и полностью", () => {
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

  it("режим сводится по уровням, выключение даёт enabled=false", () => {
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
    // a выключен на узком уровне; b осталось name-only.
    expect(view.skills.find((s) => s.name === "a")).toMatchObject({
      enabled: false,
      mode: "on",
    });
    expect(view.skills.find((s) => s.name === "b")).toMatchObject({
      enabled: true,
      mode: "name-only",
    });
  });

  it("проект: режим, совпадающий с глобальным, гасит строку", () => {
    // preflight: глобально name-only, в проекте тоже name-only → dimmed;
    // deploy: глобально on, локально off → отличие, не dimmed.
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

  it("оставшийся от удалённого навыка override видно как личный", () => {
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

describe("buildConfigView — коннекторы", () => {
  it("серверы .mcp.json: тумблер, по умолчанию выкл (нужен approve)", () => {
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

  it("сервер в enabledMcpjsonServers — включён; в disabled — выключен", () => {
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

  it("enableAllProjectMcpServers включает не упомянутые серверы", () => {
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
    // serena не упомянут → включён по enableAll; linear явно запрещён.
    expect(view.connectors.find((c) => c.name === "serena")).toMatchObject({
      value: true,
    });
    expect(view.connectors.find((c) => c.name === "linear")).toMatchObject({
      value: false,
    });
  });

  it("user- и local-серверы из ~/.claude.json — read-only", () => {
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

  it("проект: сервер .mcp.json как глобально — гасится", () => {
    // Включён на user-уровне; в проекте не переопределён → совпадает → dimmed.
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

describe("buildConfigView — хуки", () => {
  it("перечисляет хуки по уровням с происхождением", () => {
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

  it("нет хуков — пустой список", () => {
    expect(buildConfigView(input({})).hooks).toEqual([]);
  });

  it("выключенные хуки уровня идут после активных, index:-1, enabled:false", () => {
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

  it("пустой disabledHooksByLevel (в т.ч. короче levelDocs) не ломает сборку", () => {
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

describe("buildConfigView — подгрузка инструментов", () => {
  it("по умолчанию включена в режиме авто", () => {
    const view = buildConfigView(input({}));
    expect(view.toolSearch).toEqual({
      enabled: true,
      mode: "auto",
      dimmed: false,
    });
  });

  it("узкий уровень перекрывает широкий (выключение)", () => {
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

  it("проект: режим, совпадающий с глобальным, гасит строку", () => {
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

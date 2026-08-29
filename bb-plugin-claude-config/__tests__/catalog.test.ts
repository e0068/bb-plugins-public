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

  it("разбирает ключ на имя и маркетплейс", () => {
    const [figma] = parseInstalledPlugins(text);
    expect(figma).toEqual({
      key: "figma@claude-plugins-official",
      name: "figma",
      marketplace: "claude-plugins-official",
      version: "2.2.90",
      installPath: null,
    });
  });

  it("не падает на файле, которого нет или который испорчен", () => {
    expect(parseInstalledPlugins(null)).toEqual([]);
    expect(parseInstalledPlugins("{ битый")).toEqual([]);
    expect(parseInstalledPlugins("[]")).toEqual([]);
    expect(parseInstalledPlugins('{"version":2}')).toEqual([]);
  });

  it("переживает установку без версии", () => {
    const noVersion = parseInstalledPlugins('{"plugins":{"a@m":[]}}');
    expect(noVersion[0]).toMatchObject({ key: "a@m", version: null });
  });

  it("берёт installPath из установки", () => {
    const withPath = parseInstalledPlugins(
      '{"plugins":{"a@m":[{"installPath":"/p/a/1.0"}]}}',
    );
    expect(withPath[0]).toMatchObject({ installPath: "/p/a/1.0" });
  });

  it("ключ без маркетплейса остаётся целиком именем", () => {
    expect(parseInstalledPlugins('{"plugins":{"local":[{}]}}')[0]).toMatchObject(
      { name: "local", marketplace: "" },
    );
  });
});

describe("collectSkillNames", () => {
  it("берёт имя каталога, в котором лежит SKILL.md", () => {
    expect(
      collectSkillNames([
        "preflight/SKILL.md",
        "preflight/references/checks.md",
        "git-hygiene/SKILL.md",
      ]),
    ).toEqual(["git-hygiene", "preflight"]);
  });

  it("разворачивает служебный каталог synced", () => {
    expect(collectSkillNames(["synced/pdf-tools/SKILL.md"])).toEqual([
      "pdf-tools",
    ]);
  });

  it("пропускает всё, что не SKILL.md на своём уровне", () => {
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
  it("помечает происхождение и сортирует по имени", () => {
    expect(mergeSkills(["preflight"], ["deploy"])).toEqual([
      { name: "deploy", origin: "project" },
      { name: "preflight", origin: "personal" },
    ]);
  });

  it("одноимённый проектный навык перекрывает личный", () => {
    expect(mergeSkills(["deploy"], ["deploy"])).toEqual([
      { name: "deploy", origin: "project" },
    ]);
  });
});

describe("collectAgentNames", () => {
  it("берёт имя файла .md без расширения", () => {
    expect(collectAgentNames(["reviewer.md", "planner.md"])).toEqual([
      "planner",
      "reviewer",
    ]);
  });

  it("пропускает вложенные пути и не-.md файлы", () => {
    expect(
      collectAgentNames(["reviewer.md", "sub/nested.md", "README.txt"]),
    ).toEqual(["reviewer"]);
  });
});

describe("mergeAgents", () => {
  it("помечает происхождение, проектный перекрывает личного", () => {
    expect(mergeAgents(["reviewer"], ["reviewer", "deploy"])).toEqual([
      { name: "deploy", origin: "project" },
      { name: "reviewer", origin: "project" },
    ]);
  });
});

describe("transportOf", () => {
  it("берёт явный type, иначе выводит по url/command", () => {
    expect(transportOf({ type: "sse" })).toBe("sse");
    expect(transportOf({ url: "https://x" })).toBe("http");
    expect(transportOf({ command: "uvx" })).toBe("stdio");
    expect(transportOf({})).toBe("");
    expect(transportOf(null)).toBe("");
  });
});

describe("parseMcpJson", () => {
  it("разбирает mcpServers и сортирует по имени", () => {
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

  it("нет файла или незнакомая форма — пустой список", () => {
    expect(parseMcpJson(null)).toEqual([]);
    expect(parseMcpJson("{ битый")).toEqual([]);
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

  it("делит на user (верхний уровень) и local (по корню проекта)", () => {
    const { user, local } = parseClaudeJsonServers(text, "/repo");
    expect(user).toEqual([
      { name: "context7", transport: "http", config: { url: "https://c7" } },
    ]);
    expect(local).toEqual([
      { name: "serena", transport: "stdio", config: { command: "uvx" } },
    ]);
  });

  it("без корня проекта local пуст", () => {
    expect(parseClaudeJsonServers(text, null).local).toEqual([]);
  });

  it("совпадение по корню терпимо к хвостовому слэшу", () => {
    // Ключ в файле без слэша, корень из bb со слэшем — сервер всё равно найден.
    expect(parseClaudeJsonServers(text, "/repo/").local).toEqual([
      { name: "serena", transport: "stdio", config: { command: "uvx" } },
    ]);
  });

  it("нет файла — оба списка пусты", () => {
    expect(parseClaudeJsonServers(null, "/repo")).toEqual({ user: [], local: [] });
  });
});

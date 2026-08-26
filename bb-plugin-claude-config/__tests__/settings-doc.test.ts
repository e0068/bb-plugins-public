import { describe, expect, it } from "vitest";

import {
  SettingsParseError,
  getEnableAllMcp,
  getMcpServer,
  getPlugin,
  getSkill,
  getToolSearch,
  listHooks,
  listPluginKeys,
  listSkillNames,
  parse,
  serialize,
  setMcpServer,
  setPlugin,
  setSkill,
  setToolSearch,
} from "../src/settings-doc";

describe("parse", () => {
  it("считает отсутствующий и пустой файл пустым документом", () => {
    expect(parse(null)).toEqual({});
    expect(parse("")).toEqual({});
    expect(parse("   \n ")).toEqual({});
  });

  it("разбирает объект настроек", () => {
    expect(parse('{"theme":"light"}')).toEqual({ theme: "light" });
  });

  it("не подменяет битый JSON пустым документом", () => {
    // Иначе первая же запись затрёт файл, который не удалось прочитать.
    expect(() => parse("{ oops")).toThrow(SettingsParseError);
  });

  it("отвергает корень, который не объект", () => {
    expect(() => parse("[1,2]")).toThrow(SettingsParseError);
    expect(() => parse('"строка"')).toThrow(SettingsParseError);
    expect(() => parse("null")).toThrow(SettingsParseError);
  });
});

describe("serialize", () => {
  it("пишет двумя пробелами и переводом строки в конце", () => {
    expect(serialize({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });
});

describe("плагины", () => {
  const doc = parse('{"enabledPlugins":{"figma@m":true,"telegram@m":false}}');

  it("читает три состояния", () => {
    expect(getPlugin(doc, "figma@m")).toBe("on");
    expect(getPlugin(doc, "telegram@m")).toBe("off");
    expect(getPlugin(doc, "unknown@m")).toBe("inherit");
  });

  it("перечисляет упомянутые ключи", () => {
    expect(listPluginKeys(doc)).toEqual(["figma@m", "telegram@m"]);
  });

  it("включает и выключает, не трогая исходный документ", () => {
    const next = setPlugin(doc, "telegram@m", "on");
    expect(getPlugin(next, "telegram@m")).toBe("on");
    expect(getPlugin(doc, "telegram@m")).toBe("off");
  });

  it("возврат в inherit убирает ключ", () => {
    const next = setPlugin(doc, "figma@m", "inherit");
    expect(listPluginKeys(next)).toEqual(["telegram@m"]);
  });

  it("опустевшую секцию убирает целиком", () => {
    let next = setPlugin(doc, "figma@m", "inherit");
    next = setPlugin(next, "telegram@m", "inherit");
    expect(next).toEqual({});
  });

  it("заводит секцию, когда её не было", () => {
    expect(setPlugin({}, "figma@m", "off")).toEqual({
      enabledPlugins: { "figma@m": false },
    });
  });

  it("не теряет соседние ключи документа", () => {
    const withTheme = parse('{"theme":"light","enabledPlugins":{"a@m":true}}');
    const next = setPlugin(withTheme, "a@m", "off");
    expect(next.theme).toBe("light");
  });

  it("считает мусор в секции отсутствием секции, а не падает", () => {
    const broken = parse('{"enabledPlugins":"нет"}');
    expect(getPlugin(broken, "a@m")).toBe("inherit");
    expect(setPlugin(broken, "a@m", "on")).toEqual({
      enabledPlugins: { "a@m": true },
    });
  });
});

describe("навыки", () => {
  const doc = parse('{"skillOverrides":{"deploy":"off","legacy":"name-only"}}');

  it("читает известные состояния и игнорирует неизвестные", () => {
    expect(getSkill(doc, "deploy")).toBe("off");
    expect(getSkill(doc, "legacy")).toBe("name-only");
    expect(getSkill(doc, "absent")).toBe("inherit");
    expect(getSkill(parse('{"skillOverrides":{"x":"мусор"}}'), "x")).toBe(
      "inherit",
    );
  });

  it("перечисляет упомянутые имена", () => {
    expect(listSkillNames(doc)).toEqual(["deploy", "legacy"]);
  });

  it("пишет и снимает состояние", () => {
    const next = setSkill(doc, "deploy", "user-invocable-only");
    expect(getSkill(next, "deploy")).toBe("user-invocable-only");
    expect(listSkillNames(setSkill(next, "deploy", "inherit"))).toEqual([
      "legacy",
    ]);
  });
});

describe("коннекторы (MCP-серверы)", () => {
  const doc = parse(
    '{"enabledMcpjsonServers":["a"],"disabledMcpjsonServers":["b"]}',
  );

  it("читает три состояния; запрет старше разрешения", () => {
    expect(getMcpServer(doc, "a")).toBe("on");
    expect(getMcpServer(doc, "b")).toBe("off");
    expect(getMcpServer(doc, "c")).toBe("inherit");
    const both = parse(
      '{"enabledMcpjsonServers":["x"],"disabledMcpjsonServers":["x"]}',
    );
    expect(getMcpServer(both, "x")).toBe("off");
  });

  it("on/off правят оба массива, inherit убирает из обоих", () => {
    const on = setMcpServer(doc, "c", "on");
    expect(getMcpServer(on, "c")).toBe("on");
    // Переключение b с off на on убирает его из disabled.
    const flipped = setMcpServer(doc, "b", "on");
    expect(flipped.disabledMcpjsonServers).toBeUndefined();
    expect(getMcpServer(flipped, "b")).toBe("on");
    // inherit снимает запись целиком; опустевшие массивы уходят.
    const cleared = setMcpServer(setMcpServer(doc, "a", "inherit"), "b", "inherit");
    expect(cleared).toEqual({});
  });

  it("не трогает исходный документ и соседние ключи", () => {
    const withTheme = parse('{"theme":"dark","enabledMcpjsonServers":["a"]}');
    const next = setMcpServer(withTheme, "a", "off");
    expect(next.theme).toBe("dark");
    expect(getMcpServer(withTheme, "a")).toBe("on");
  });

  it("читает enableAllProjectMcpServers", () => {
    expect(getEnableAllMcp({})).toBeUndefined();
    expect(getEnableAllMcp(parse('{"enableAllProjectMcpServers":true}'))).toBe(
      true,
    );
    expect(getEnableAllMcp(parse('{"enableAllProjectMcpServers":false}'))).toBe(
      false,
    );
  });
});

describe("хуки", () => {
  it("разворачивает события и группы в плоский список", () => {
    const doc = parse(
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "lint" }] },
          ],
          UserPromptSubmit: [
            {
              hooks: [
                { type: "command", command: "one" },
                { type: "command", command: "two" },
              ],
            },
          ],
        },
      }),
    );
    expect(listHooks(doc)).toEqual([
      { event: "PreToolUse", matcher: "Bash", command: "lint" },
      { event: "UserPromptSubmit", matcher: null, command: "one" },
      { event: "UserPromptSubmit", matcher: null, command: "two" },
    ]);
  });

  it("пустой matcher считает отсутствующим, мусор пропускает", () => {
    const doc = parse(
      JSON.stringify({
        hooks: {
          Stop: [{ matcher: "", hooks: [{ type: "command", command: "x" }] }],
          Bad: "нет",
        },
      }),
    );
    expect(listHooks(doc)).toEqual([
      { event: "Stop", matcher: null, command: "x" },
    ]);
  });

  it("нет ключа hooks — пустой список", () => {
    expect(listHooks({})).toEqual([]);
  });
});

describe("подгрузка инструментов", () => {
  it("читает все формы значения", () => {
    expect(getToolSearch({})).toBe("inherit");
    expect(getToolSearch(parse('{"env":{"ENABLE_TOOL_SEARCH":"true"}}'))).toBe(
      "on",
    );
    expect(getToolSearch(parse('{"env":{"ENABLE_TOOL_SEARCH":"false"}}'))).toBe(
      "off",
    );
    expect(getToolSearch(parse('{"env":{"ENABLE_TOOL_SEARCH":"auto"}}'))).toBe(
      "auto",
    );
    // Порог живёт внутри значения, режим тот же.
    expect(
      getToolSearch(parse('{"env":{"ENABLE_TOOL_SEARCH":"auto:5"}}')),
    ).toBe("auto");
  });

  it("пишет значение в env и убирает его при возврате", () => {
    const on = setToolSearch({}, "off");
    expect(on).toEqual({ env: { ENABLE_TOOL_SEARCH: "false" } });
    expect(setToolSearch(on, "inherit")).toEqual({});
  });

  it("не сносит соседние переменные окружения", () => {
    const doc = parse('{"env":{"DEBUG":"1","ENABLE_TOOL_SEARCH":"false"}}');
    expect(setToolSearch(doc, "inherit")).toEqual({ env: { DEBUG: "1" } });
  });
});

import { describe, expect, it } from "vitest";

import {
  decideMcpOwn,
  resolveEnableAllMcp,
  resolveMcpServer,
  resolvePlugin,
  resolveSkill,
  resolveToolSearch,
} from "../src/effective";

describe("сведение уровней", () => {
  it("узкий уровень перебивает широкий", () => {
    expect(resolvePlugin(["on", "off"])).toBe("off");
    expect(resolvePlugin(["off", "on"])).toBe("on");
  });

  it("уровень без значения пропускается", () => {
    expect(resolvePlugin(["on", "inherit"])).toBe("on");
    expect(resolveSkill(["off", "inherit"])).toBe("off");
  });

  it("значения нет нигде — берётся умолчание Claude Code", () => {
    // Плагина нет в настройках — он выключен.
    expect(resolvePlugin(["inherit", "inherit"])).toBe("off");
    expect(resolvePlugin([])).toBe("off");
    // Навык без override виден полностью.
    expect(resolveSkill(["inherit"])).toBe("on");
    // ENABLE_TOOL_SEARCH не задана — Claude Code ведёт себя как auto.
    expect(resolveToolSearch(["inherit"])).toBe("auto");
  });

  it("сводит все состояния навыка", () => {
    expect(resolveSkill(["on", "name-only"])).toBe("name-only");
    expect(resolveSkill(["off", "user-invocable-only"])).toBe(
      "user-invocable-only",
    );
  });

  it("сводит режимы подгрузки инструментов", () => {
    expect(resolveToolSearch(["on", "auto"])).toBe("auto");
    expect(resolveToolSearch(["auto", "off"])).toBe("off");
  });

  it("MCP-сервер: явное значение старше умолчания от enableAll", () => {
    // Без записи умолчание зависит от enableAll.
    expect(resolveMcpServer(["inherit"], false)).toBe("off");
    expect(resolveMcpServer(["inherit"], true)).toBe("on");
    // Явный off перебивает enableAll; узкий уровень перебивает широкий.
    expect(resolveMcpServer(["off"], true)).toBe("off");
    expect(resolveMcpServer(["on", "off"], false)).toBe("off");
  });

  it("enableAll сводится последним заданным уровнем", () => {
    expect(resolveEnableAllMcp([])).toBe(false);
    expect(resolveEnableAllMcp([true, undefined])).toBe(true);
    expect(resolveEnableAllMcp([true, false])).toBe(false);
  });

  describe("decideMcpOwn — минимальная запись коннектора", () => {
    it("совпало со старшими уровнями — снимает оверрайд", () => {
      expect(decideMcpOwn(["on"], [undefined, undefined], "on")).toBe("inherit");
      expect(decideMcpOwn([], [undefined], "off")).toBe("inherit");
    });

    it("отличается — ставит явно", () => {
      expect(decideMcpOwn(["on"], [undefined, undefined], "off")).toBe("off");
      expect(decideMcpOwn([], [undefined], "on")).toBe("on");
    });

    it("enableAll на редактируемом уровне учитывается при снятии оверрайда", () => {
      // Баг-кейс: enableAll:true в самом редактируемом файле, сервер нигде явно
      // не задан → действует on. Выключаем: inherit оставил бы on, поэтому нужен
      // явный off. enableAllLevels включает уровень редактируемого файла.
      expect(decideMcpOwn([], [true], "off")).toBe("off");
      // Тот же enableAll, включаем — inherit и так даёт on.
      expect(decideMcpOwn([], [true], "on")).toBe("inherit");
    });
  });
});

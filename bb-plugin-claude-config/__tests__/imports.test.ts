import { describe, expect, it } from "vitest";

import { parseImports, resolveImportPath } from "../src/imports";

describe("parseImports", () => {
  it("находит относительный импорт с расширением", () => {
    expect(parseImports("Смотри @AGENTS.md для правил.")).toEqual(["AGENTS.md"]);
  });

  it("находит импорт от домашнего каталога", () => {
    expect(parseImports("@~/.claude/skills/x/SKILL.md")).toEqual([
      "~/.claude/skills/x/SKILL.md",
    ]);
  });

  it("находит явно относительный импорт ./", () => {
    expect(parseImports("@./rel/y.md")).toEqual(["./rel/y.md"]);
  });

  it("не путает e-mail с импортом", () => {
    expect(parseImports("Пиши на user@example.com за помощью.")).toEqual([]);
  });

  it("схлопывает точные дубли, сохраняя первое появление", () => {
    expect(parseImports("@AGENTS.md и снова @AGENTS.md")).toEqual(["AGENTS.md"]);
  });

  it("игнорирует строки внутри огороженных код-блоков", () => {
    const text = ["текст @AGENTS.md", "```", "@fake.md внутри блока", "```", "@REAL.md"].join(
      "\n",
    );
    expect(parseImports(text)).toEqual(["AGENTS.md", "REAL.md"]);
  });

  it("обрезает хвостовую пунктуацию", () => {
    expect(parseImports("см. @AGENTS.md.")).toEqual(["AGENTS.md"]);
    expect(parseImports("(см. @AGENTS.md)")).toEqual(["AGENTS.md"]);
    expect(parseImports("@AGENTS.md,")).toEqual(["AGENTS.md"]);
  });

  it("в начале строки импорт распознаётся без пробела перед ним", () => {
    expect(parseImports("@AGENTS.md")).toEqual(["AGENTS.md"]);
  });

  it("токен без похожести на файл не считается импортом", () => {
    expect(parseImports("Версия @2 релиза")).toEqual([]);
  });

  it("пустой текст — пустой список", () => {
    expect(parseImports("")).toEqual([]);
  });
});

describe("resolveImportPath", () => {
  const home = "/Users/vs";
  const fromFile = "/Users/vs/project/CLAUDE.md";

  it("раскрывает ~ от домашнего каталога", () => {
    expect(resolveImportPath(fromFile, "~/.claude/skills/x/SKILL.md", home)).toBe(
      "/Users/vs/.claude/skills/x/SKILL.md",
    );
  });

  it("голый ~ разрешается в сам домашний каталог", () => {
    expect(resolveImportPath(fromFile, "~", home)).toBe("/Users/vs");
  });

  it("абсолютный путь возвращается как есть (нормализованным)", () => {
    expect(resolveImportPath(fromFile, "/etc/hosts", home)).toBe("/etc/hosts");
  });

  it("относительный путь разрешается от каталога исходного файла", () => {
    expect(resolveImportPath(fromFile, "./AGENTS.md", home)).toBe(
      "/Users/vs/project/AGENTS.md",
    );
    expect(resolveImportPath(fromFile, "../shared/rules.md", home)).toBe(
      "/Users/vs/shared/rules.md",
    );
  });

  it("голое имя без ./ тоже относительно каталога исходного файла", () => {
    expect(resolveImportPath(fromFile, "AGENTS.md", home)).toBe(
      "/Users/vs/project/AGENTS.md",
    );
  });
});

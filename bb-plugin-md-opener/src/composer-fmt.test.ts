import { describe, expect, it } from "vitest";

import { FMT, applyFmt, isSeparator, type FmtButton } from "./composer-fmt";

const button = (key: string): FmtButton => {
  const found = FMT.find((row) => !isSeparator(row) && row.key === key);
  if (!found || isSeparator(found)) throw new Error(`нет кнопки ${key}`);
  return found;
};

describe("applyFmt — обёртки Касимова", () => {
  it("строчные кнопки оборачивают выделение своей парой", () => {
    expect(applyFmt("текст", button("bold"))).toBe("**текст**");
    expect(applyFmt("текст", button("italic"))).toBe("*текст*");
    expect(applyFmt("текст", button("underline"))).toBe("++текст++");
    expect(applyFmt("текст", button("strike"))).toBe("~~текст~~");
    expect(applyFmt("текст", button("code"))).toBe("`текст`");
    expect(applyFmt("текст", button("link"))).toBe("[текст](url)");
  });

  it("построчные кнопки ставят префикс каждой задетой строке", () => {
    expect(applyFmt("раз\nдва", button("h2"))).toBe("## раз\n## два");
    expect(applyFmt("раз\nдва", button("bullet"))).toBe("- раз\n- два");
    expect(applyFmt("раз", button("quote"))).toBe("> раз");
  });

  it("блок кода заворачивает выделение в ограждение", () => {
    expect(applyFmt("npm test", button("codeblock"))).toBe("```\nnpm test\n```");
  });
});

describe("applyFmt — заготовка таблицы", () => {
  it("без выделения — две колонки Column, как в insertStarterTable", () => {
    expect(applyFmt("", button("table"))).toBe(
      "| Column | Column |\n| ------ | ------ |\n|  |  |",
    );
  });

  it("выделенные слова становятся заголовками колонок", () => {
    expect(applyFmt("Файл  Слой", button("table"))).toBe(
      "| Файл | Слой |\n| ------ | ------ |\n|  |  |",
    );
  });

  it("вертикальная черта в слове экранируется, чтобы не разбить строку", () => {
    expect(applyFmt("a|b", button("table")).split("\n")[0]).toBe("| a\\|b |");
  });
});

describe("таблица FMT", () => {
  it("ключи кнопок уникальны, у каждой есть глиф и имя", () => {
    const buttons = FMT.filter((row) => !isSeparator(row)) as FmtButton[];
    expect(new Set(buttons.map((b) => b.key)).size).toBe(buttons.length);
    for (const b of buttons) {
      expect(b.name.length).toBeGreaterThan(0);
      expect(Boolean(b.l || b.icon)).toBe(true);
    }
  });
});

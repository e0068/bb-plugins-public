// @vitest-environment node
import { describe, expect, it } from "vitest";

import { frontmatter } from "./frontmatter";

describe("шапка markdown-файла", () => {
  it("поля шапки — строками, без пробелов по краям", () => {
    expect(frontmatter("---\nname: reviewer\nmodel:  opus \n---\nтело")).toEqual({ name: "reviewer", model: "opus" });
  });

  it("длинное значение, перенесённое на строки с отступом, склеивается через пробел", () => {
    const text = '---\ntitle: "Flow — ссылки у сделанного этапа: инструкция против\n  проверки отчёта"\nslug: x\n---\n';
    expect(frontmatter(text)).toEqual({ title: '"Flow — ссылки у сделанного этапа: инструкция против проверки отчёта"', slug: "x" });
  });

  it("пункты списка под пустым полем к нему не приклеиваются", () => {
    expect(frontmatter("---\nchecks:\n  - test\n  - review\nslug: x\n---\n")).toEqual({ checks: "", slug: "x" });
  });

  it("переводы строк CRLF читаются так же", () => {
    expect(frontmatter("---\r\ntitle: Задача\r\n  дальше\r\n---\r\n")).toEqual({ title: "Задача дальше" });
  });

  it("без шапки в начале файла полей нет", () => {
    expect(frontmatter("# title: не шапка\n")).toBeNull();
    expect(frontmatter("текст\n---\ntitle: x\n---\n")).toBeNull();
  });
});

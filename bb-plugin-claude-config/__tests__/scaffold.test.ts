import { describe, expect, it } from "vitest";

import {
  agentTemplate,
  isValidName,
  skillTemplate,
  slugifyName,
} from "../src/scaffold";

describe("slugifyName", () => {
  it("приводит к строчным и заменяет пробелы на дефис", () => {
    expect(slugifyName("My New Skill")).toBe("my-new-skill");
  });

  it("схлопывает повторы разделителей в один дефис", () => {
    expect(slugifyName("a  b__c")).toBe("a-b-c");
  });

  it("срезает дефисы по краям", () => {
    expect(slugifyName("  -hello- ")).toBe("hello");
  });

  it("выбрасывает недопустимые символы", () => {
    expect(slugifyName("Привет! v2")).toBe("v2");
  });

  it("пустой ввод даёт пустой слаг", () => {
    expect(slugifyName("   ")).toBe("");
    expect(slugifyName("!!!")).toBe("");
  });
});

describe("isValidName", () => {
  it("имя с латиницей или цифрой допустимо", () => {
    expect(isValidName("skill")).toBe(true);
    expect(isValidName("v2")).toBe(true);
  });

  it("имя без допустимых символов недопустимо", () => {
    expect(isValidName("   ")).toBe(false);
    expect(isValidName("!!!")).toBe(false);
  });
});

describe("skillTemplate", () => {
  it("подставляет имя в frontmatter и заголовок", () => {
    const text = skillTemplate("my-skill");
    expect(text).toContain("name: my-skill");
    expect(text).toContain("# my-skill");
    expect(text.startsWith("---\n")).toBe(true);
    expect(text).toContain("description:");
  });
});

describe("agentTemplate", () => {
  it("подставляет имя в frontmatter", () => {
    const text = agentTemplate("my-agent");
    expect(text).toContain("name: my-agent");
    expect(text.startsWith("---\n")).toBe(true);
    expect(text).toContain("description:");
  });
});

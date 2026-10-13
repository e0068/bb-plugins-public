// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("навык Демонстрации учит выводить прототип в виджет", () => {
  it.each(["./skills/flow-demo/SKILL.md", "./skills/flow-demo/ru.md"])("%s называет поле итога и весь протокол окна", (path) => {
    const text = read(path);
    expect(text).toMatch(/`prototype: \{ url/);
    expect(text).toMatch(/source: "bb-prototype"/);
    for (const type of ["ready", "choice", "picked", "restore", "set", "pick"]) expect(text).toContain(`type: "${type}"`);
  });
});

// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("навык демонстрации", () => {
  it("велит показывать текст пункта ченж-лога разделом демонстрации", () => {
    expect(read("./skills/flow-demo/SKILL.md")).toMatch(/section "Changelog" in `sections`/);
    expect(read("./skills/flow-demo/ru.md")).toMatch(/раздел «Ченж-лог» в `sections`/);
  });
});

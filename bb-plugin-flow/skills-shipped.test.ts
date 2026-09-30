// @vitest-environment node
// Плагин ставят из маркетплейса, где личных навыков владельца нет: всякий навык, который
// плагин называет сам, должен лежать в его папке skills — английский SKILL.md и русский ru.md.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEFAULT_STAGES } from "./core/flows";
import { BUILTIN_SKILLS, FLOW_CREATE_SKILL, stageSkillOf } from "./lib/stage-constants";

const file = (name: string, doc: string) => new URL(`./skills/${name}/${doc}`, import.meta.url);
const frontName = (text: string) => /^---\nname: (\S+)\n/.exec(text)?.[1];

const named = [...new Set([...Object.values(BUILTIN_SKILLS), ...DEFAULT_STAGES.map(stageSkillOf), FLOW_CREATE_SKILL])];

describe("навыки, которые плагин называет сам, едут в плагине", () => {
  it.each(named)("%s — SKILL.md с тем же именем в шапке и ru.md рядом", (name) => {
    expect(existsSync(file(name, "SKILL.md"))).toBe(true);
    expect(frontName(readFileSync(file(name, "SKILL.md"), "utf8"))).toBe(name);
    expect(existsSync(file(name, "ru.md"))).toBe(true);
  });

  it("английский SKILL.md отсылает к русскому ru.md, а ru.md — навык целиком, без шапки", () => {
    for (const name of named) {
      expect(readFileSync(file(name, "SKILL.md"), "utf8")).toContain("[ru.md](ru.md)");
      expect(readFileSync(file(name, "ru.md"), "utf8")).not.toMatch(/^---/);
    }
  });
});

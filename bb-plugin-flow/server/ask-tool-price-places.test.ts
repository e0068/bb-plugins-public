// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ASK_INSTRUCTIONS } from "./ask-tool";

const skill = readFileSync(new URL("../skills/flow/SKILL.md", import.meta.url), "utf8");

describe("у цены работы одно место", () => {
  it("инструкции не велят класть цену на этапы, пункты и варианты сразу", () => {
    expect(ASK_INSTRUCTIONS).not.toContain("Put add on stages, criteria items and options");
  });

  it("инструкции и навык называют цену работы на этапах, долю пункта и разницу варианта", () => {
    for (const text of [ASK_INSTRUCTIONS, skill]) {
      expect(text).toContain("the price of the work is on the stages");
      expect(text).toContain("share inside the stages, not on top of them");
      expect(text).toContain("difference from the recommended option");
    }
  });

  it("инструкции и навык учат класть пункты варианта в его criteria", () => {
    for (const text of [ASK_INSTRUCTIONS, skill]) expect(text).toContain("criteria on an option");
  });
});

describe("вариант со снятыми пунктами", () => {
  it("навык говорит, что доли пунктов из removes плагин вычитает сам", () => {
    expect(skill).toContain("the plugin subtracts the shares of the items in removes itself");
  });
});

describe("пункт, который зависит от ответа", () => {
  it("инструкции и навык говорят, что снятый владельцем вариант оставляет свой пункт зачёркнутым", () => {
    for (const text of [ASK_INSTRUCTIONS, skill]) expect(text).toContain("an item of an option the owner drops themselves stays in the list struck through");
  });

  it("инструкции и навык велят писать такой пункт в вариант, а не в setup.criteria", () => {
    for (const text of [ASK_INSTRUCTIONS, skill]) expect(text).toContain("goes on the option, not into setup.criteria");
  });
});

// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ASK_INSTRUCTIONS } from "./ask-tool";

const skill = readFileSync(new URL("../skills/flow/SKILL.md", import.meta.url), "utf8");

describe("агент знает про добавки, пункт-изменение и прогноз бюджета", () => {
  it("инструкции называют add с целью, потолком и риском числом, где его ставить и что бюджет — прогноз", () => {
    for (const word of ["add", "target", "max", "risk", "before", "after", "adds"]) expect(ASK_INSTRUCTIONS).toContain(word);
    expect(ASK_INSTRUCTIONS).toContain("budget forecast");
  });

  it("инструкции больше не учат присылать два ряда бюджетов", () => {
    expect(ASK_INSTRUCTIONS).not.toContain("budgetTarget и budgetMax — целевой и максимальный бюджет");
  });

  it("навык показывает add в примере и объясняет строку «Budget» в ответе", () => {
    expect(skill).toContain('"add": {');
    expect(skill).toContain("Budget — forecast");
  });
});

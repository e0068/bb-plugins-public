// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { ASK_INSTRUCTIONS } from "./ask-tool";

describe("знак и шкала риска этапа в правилах агента", () => {
  it("инструкции инструмента и навык говорят, что проверки снижают риск, а правка кода повышает", async () => {
    const skill = await readFile(new URL("../skills/flow/SKILL.md", import.meta.url), "utf8");
    for (const text of [ASK_INSTRUCTIONS, skill]) {
      expect(text).toMatch(/spec, plan, prototype, review and testing lower it/);
      expect(text).toMatch(/implementation raises it/);
      expect(text).toMatch(/1r ≈ 10%/);
    }
  });

  it("навык даёт шкалу по этапам и называет, что замерено, а что оценено", async () => {
    const skill = await readFile(new URL("../skills/flow/SKILL.md", import.meta.url), "utf8");
    expect(skill).toContain("43 of 83");
    expect(skill).toMatch(/not measured/);
  });
});

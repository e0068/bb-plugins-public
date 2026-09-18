// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { ASK_INSTRUCTIONS } from "./ask-tool";

describe("пометка hides в правилах агента", () => {
  it("инструкции инструмента и навык называют hides и что скрытых вопросов владелец не видит", async () => {
    const skill = await readFile(new URL("../skills/flow/SKILL.md", import.meta.url), "utf8");
    for (const text of [ASK_INSTRUCTIONS, skill]) {
      expect(text).toContain("hides");
      expect(text).toMatch(/does not see/);
    }
  });
});

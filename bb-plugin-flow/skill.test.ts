// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { askDecisionParamsSchema } from "./shared/contract";
import { ASK_INSTRUCTIONS } from "./server/ask-tool";

const skill = readFileSync(new URL("./skills/flow/SKILL.md", import.meta.url), "utf8");
const examples = [...skill.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1] ?? ""));

describe("навык decisions", () => {
  it("каждый пример брифа проходит схему инструмента", () => {
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) expect(askDecisionParamsSchema.safeParse(example).error?.issues ?? []).toEqual([]);
  });

  it("инструкции инструмента помещаются в 4096 символов", () => {
    expect(ASK_INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
  });
});

describe("навык decisions без приоритета", () => {
  it("текст навыка не учит слать приоритет и называет ревью и тестирование", () => {
    expect(skill).not.toMatch(/\bpriority\b/i);
    for (const word of ["review", "testing", "minutes"]) expect(skill.toLowerCase()).toContain(word);
  });
});

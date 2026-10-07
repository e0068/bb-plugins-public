// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { askDecisionParamsSchema } from "./shared/contract";
import { ASK_INSTRUCTIONS } from "./server/ask-tool";

/** Навык flow и навыки встроенных этапов: формат каждой части брифа лежит в навыке её этапа. */
const FILES = ["flow/SKILL.md", ...["flow-questions", "flow-criteria", "flow-stage-selection", "flow-demo"].flatMap((name) => [`${name}/SKILL.md`, `${name}/ru.md`])];
const texts = FILES.map((file) => readFileSync(new URL(`./skills/${file}`, import.meta.url), "utf8"));
const examples = texts.flatMap((text) => [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1] ?? "")));

describe("навыки брифа", () => {
  it("каждый пример брифа проходит схему инструмента", () => {
    expect(examples.length).toBeGreaterThanOrEqual(FILES.length);
    for (const example of examples) expect(askDecisionParamsSchema.safeParse(example).error?.issues ?? []).toEqual([]);
  });

  it("инструкции инструмента помещаются в 4096 символов", () => {
    expect(ASK_INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
  });
});

describe("навыки брифа без приоритета", () => {
  it("тексты навыков не учат слать приоритет и называют ревью, тестирование и минуты", () => {
    const all = texts.join("\n");
    expect(all).not.toMatch(/\bpriority\b/i);
    for (const word of ["review", "testing", "minutes"]) expect(all.toLowerCase()).toContain(word);
  });
});

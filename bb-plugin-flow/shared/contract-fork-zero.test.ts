// @vitest-environment node
// BBPL-531: минус у варианта значит, что в базе лежит ответ богаче самого простого. Развилки — из четырёх брифов 02.10.
import { describe, expect, it } from "vitest";

import { askDecisionParamsSchema } from "./contract";
import { BASE_CRITERIA, REJECTED_FORKS, REWRITTEN_FORKS } from "./fork-zero-fixtures";

const issues = (value: unknown): string[] => {
  const parsed = askDecisionParamsSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
};

const brief = (question: unknown) => ({ title: "Бриф", setup: { criteria: [...BASE_CRITERIA] }, questions: [question] });

describe("минус у варианта развилки: в базе лежит ответ богаче самого простого", () => {
  it.each(Object.entries(REJECTED_FORKS))("бриф %s в присланном виде отклоняется, и отказ называет правило", (_, question) => {
    const text = issues(brief(question)).join(" ");
    expect(text).toContain("never negative");
    expect(text).toContain("simplest option costs 0");
  });

  it.each(Object.entries(REWRITTEN_FORKS))("бриф %s, переписанный по правилу, принимается схемой", (_, question) => {
    expect(issues(brief(question))).toEqual([]);
  });
});

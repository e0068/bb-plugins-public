// @vitest-environment node
// Учебное содержимое карточки каждого вида — настоящий виджет: схема виджета принимает его на обоих языках.
import { describe, expect, it } from "vitest";

import { BUILTIN_KINDS } from "../lib/stage-constants";
import { en } from "../lib/messages/en";
import { ru } from "../lib/messages/ru";
import { editedRule, proposalIssues } from "../core/rule";
import { decisionBriefSchema, ruleRecordSchema } from "../shared/contract";
import { exampleBrief, exampleRule } from "./widget-page";

describe("учебное содержимое карточки виджета", () => {
  it.each([
    ["ru", ru],
    ["en", en],
  ] as const)("все виды проходят схему виджета, язык %s", (_, messages) => {
    const problems = BUILTIN_KINDS.map((kind) => {
      const parsed = decisionBriefSchema.safeParse(exampleBrief(kind, messages));
      return parsed.success ? null : `${kind}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`;
    });
    expect(problems.filter((p) => p !== null)).toEqual([]);
  });

  it("id каждого вида свой и не похож на id настоящего виджета: сервер для него черновик отвергает", () => {
    const ids = BUILTIN_KINDS.map((kind) => exampleBrief(kind, ru).id);
    expect(new Set(ids).size).toBe(BUILTIN_KINDS.length);
    expect(ids.every((id) => id.startsWith("example:"))).toBe(true);
  });

  it.each([
    ["ru", ru],
    ["en", en],
  ] as const)("учебное правило — замена, которую пропустил бы инструмент, язык %s", (_, messages) => {
    const rule = exampleRule(messages);
    expect(ruleRecordSchema.safeParse(rule).success).toBe(true);
    expect(proposalIssues(rule, "/Users/you")).toEqual([]);
    expect(editedRule(rule, "Б")).toEqual({ content: "Б.\n", index: undefined });
  });
});

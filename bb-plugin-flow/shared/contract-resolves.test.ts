import { describe, expect, it } from "vitest";
import { z } from "zod";
import { askDecisionParamsSchema } from "./contract";

const clarify = { title: "Находки", kind: "clarify", questions: [{ id: "q", kind: "yesno", question: "Чинить?", options: [{ id: "yes", action: "Да" }, { id: "no", action: "Нет" }] }] };

describe("resolves в параметрах ask_decision", () => {
  it("список id принимается как есть", () => {
    expect(askDecisionParamsSchema.parse({ ...clarify, resolves: ["dec_a", "dec_b"] }).resolves).toEqual(["dec_a", "dec_b"]);
  });

  it("список строкой JSON — от моста со старым описанием инструмента — разбирается в тот же список", () => {
    expect(askDecisionParamsSchema.parse({ ...clarify, resolves: '["dec_a","dec_b"]' }).resolves).toEqual(["dec_a", "dec_b"]);
  });

  it("строка, которая не список, и пустой список отбиваются", () => {
    expect(askDecisionParamsSchema.safeParse({ ...clarify, resolves: "dec_a" }).success).toBe(false);
    expect(askDecisionParamsSchema.safeParse({ ...clarify, resolves: "[]" }).success).toBe(false);
  });

  it("агент по-прежнему видит resolves массивом строк в описании инструмента", () => {
    const schema = z.toJSONSchema(askDecisionParamsSchema, { io: "input" }) as { properties: Record<string, { type?: string }> };
    expect(schema.properties.resolves?.type).toBe("array");
  });
});

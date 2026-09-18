// @vitest-environment node
import { describe, expect, it } from "vitest";

import { askDecisionParamsSchema, decisionsRpcContract } from "./contract";

const add = { target: 1, max: 2, risk: 0 };
const option = (id: string, extra: Record<string, unknown> = {}) => ({ id, action: `Вариант ${id}`, description: "Что будет", add, ...extra });
const fork = (id: string, options: unknown[]) => ({ id, question: `Вопрос ${id}?`, kind: "fork", options });
const brief = (hides: string[]) => ({
  title: "Бриф",
  questions: [fork("how", [option("a", { hides }), option("b")]), fork("where", [option("c"), option("d")])],
});

describe("пометка hides у варианта", () => {
  it("вариант скрывает другой вопрос того же брифа", () => {
    expect(askDecisionParamsSchema.safeParse(brief(["where"])).success).toBe(true);
  });

  it("ссылка на неизвестный вопрос и на свой собственный отбивается", () => {
    expect(askDecisionParamsSchema.safeParse(brief(["nowhere"])).success).toBe(false);
    expect(askDecisionParamsSchema.safeParse(brief(["how"])).success).toBe(false);
  });

  it("hides на вопрос выше отбивается: скрывать можно только то, что ниже", () => {
    const upward = { title: "Бриф", questions: [fork("how", [option("a"), option("b")]), fork("where", [option("c", { hides: ["how"] }), option("d")])] };
    expect(askDecisionParamsSchema.safeParse(upward).success).toBe(false);
  });
});

describe("картинки во входе answerBrief", () => {
  const input = decisionsRpcContract.answerBrief.input;
  const image = (n: number, extra: Record<string, unknown> = {}) => ({ n, mimeType: "image/png", dataBase64: "iVBORw0KGgo=", ...extra });
  const call = (images: unknown) => ({ id: "dec_1", messageId: "msg_1", answer: { briefId: "dec_1", answers: [] }, images });

  it("картинка несёт номер своей метки; без картинок и с шестью — проходит", () => {
    expect(input.safeParse({ id: "dec_1", messageId: "msg_1", answer: { briefId: "dec_1", answers: [] } }).success).toBe(true);
    expect(input.safeParse(call([1, 3, 4, 5, 6, 9].map((n) => image(n)))).success).toBe(true);
  });

  it("седьмая, повтор номера, svg и больше 16 МБ base64 отбиваются", () => {
    expect(input.safeParse(call([1, 2, 3, 4, 5, 6, 7].map((n) => image(n)))).success).toBe(false);
    expect(input.safeParse(call([image(2), image(2)])).success).toBe(false);
    expect(input.safeParse(call([image(1, { mimeType: "image/svg+xml" })])).success).toBe(false);
    expect(input.safeParse(call([image(1, { dataBase64: "A".repeat(16 * 1024 * 1024 + 4) })])).success).toBe(false);
  });
});

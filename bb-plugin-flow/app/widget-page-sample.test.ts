import { describe, expect, it } from "vitest";

import { messages } from "../lib/messages";
import { exampleBrief } from "./widget-page";

describe("примеры виджетов на странице Flow", () => {
  it("пример Вопросов показывает все виды вопросов: развилку, выбор нескольких, «правильно ли я понял» и да/нет", () => {
    expect(exampleBrief("questions", messages("ru")).questions.map((q) => q.kind)).toEqual(["fork", "pick", "confirm", "yesno"]);
  });

  it("Вопросы, Definition of Done, Выбор этапов и Демонстрация — без нижней секции, правки уходят с Утверждением", () => {
    for (const kind of ["questions", "criteria", "select", "demo"] as const) expect(exampleBrief(kind, messages("ru")).settle).toBe("approval");
    expect(exampleBrief("approve", messages("ru")).settle).toBeUndefined();
  });
});

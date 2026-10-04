import { describe, expect, it } from "vitest";

import { demoVerdict, outcomeAnswered } from "./outcome";

describe("свой ответ в строке вопроса обычного брифа", () => {
  it("исхода Демонстрации не даёт: у ответа без итога исхода нет", () => {
    const answer = { answers: [{ questionId: "q", optionIds: ["a"], own: "мой текст" }] };
    expect(demoVerdict(answer)).toBeNull();
    expect(outcomeAnswered(answer)).toBe(false);
  });
});

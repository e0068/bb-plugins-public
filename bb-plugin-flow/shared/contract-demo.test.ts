// @vitest-environment node
import { describe, expect, it } from "vitest";

import { stageOutcomeSchema } from "./contract";

const base = { stage: "demo", final: true, done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] };

describe("итог Демонстрации в схеме", () => {
  it("секции — заголовок и текст, необязательны", () => {
    expect(stageOutcomeSchema.safeParse(base).success).toBe(true);
    expect(stageOutcomeSchema.safeParse({ ...base, sections: [{ title: "Как проверено", text: "Тесты.\n\nСкриншоты." }] }).success).toBe(true);
    expect(stageOutcomeSchema.safeParse({ ...base, sections: [{ title: "Без текста" }] }).success).toBe(false);
    expect(stageOutcomeSchema.safeParse({ ...base, sections: [] }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { emptyDraft, finishes, setOutcomeFlow, setOutcomeNote } from "./draft";

const outcome = { stage: "demo", final: true, done: ["Готово"], pending: [], results: [{ label: "x", target: "x" }] };
const final: DecisionBrief = { id: "dec_1", threadId: "thr_1", title: "Итог", createdAt: "2026-10-09T10:00:00.000Z", kind: "brief", questions: [], outcome };

describe("кнопка Демонстрации — «Завершить»", () => {
  it("финальная Демонстрация без комментария завершает прогон", () => {
    expect(finishes(final, emptyDraft())).toBe(true);
  });

  it("нефинальная Демонстрация и бриф без итога не завершают", () => {
    expect(finishes({ ...final, outcome: { ...outcome, final: false } }, emptyDraft())).toBe(false);
    const { outcome: _outcome, ...brief } = final;
    expect(finishes(brief, emptyDraft())).toBe(false);
  });

  it("комментарий превращает «Завершить» в «Отправить»", () => {
    expect(finishes(final, setOutcomeNote(emptyDraft(), "Поправь подпись"))).toBe(false);
  });

  it("рекомендованный переход в другой flow — не завершение, «Не переходить» — завершение", () => {
    const offered: DecisionBrief = { ...final, outcome: { ...outcome, nextFlow: "flow-x" } };
    expect(finishes(offered, emptyDraft())).toBe(false);
    expect(finishes(offered, setOutcomeFlow(emptyDraft(), null))).toBe(true);
  });
});

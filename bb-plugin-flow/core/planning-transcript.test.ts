// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { answerMessageText } from "./answer-message";
import { forecast, hasForecast } from "./budget";
import { planningMinutes, transcriptCost } from "./planning";

const assistant = (id: string, requestId: string, model: string, usage: Record<string, unknown>) =>
  JSON.stringify({ type: "assistant", requestId, message: { id, model, usage } });

describe("стоимость планирования по логу сессии — как считает Token Usage", () => {
  it("вход, запись в кэш на 5 минут и на час, чтение кэша и выход — по цене семейства модели", () => {
    const line = assistant("m1", "r1", "claude-opus-5", {
      input_tokens: 1_000_000,
      cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 },
      cache_read_input_tokens: 10_000_000,
      output_tokens: 100_000,
    });
    // Opus: вход 5; запись 5м ×1.25 = 6.25; запись 1ч ×2 = 10; чтение ×0.1 = 5; выход 25 за миллион → 2.5.
    expect(transcriptCost([line])).toBe(28.75);
  });

  it("повторы одного ответа при стриминге схлопываются — побеждает последняя запись", () => {
    const first = assistant("m1", "r1", "claude-sonnet-5", { input_tokens: 0, output_tokens: 100_000 });
    const last = assistant("m1", "r1", "claude-sonnet-5", { input_tokens: 0, output_tokens: 1_000_000 });
    expect(transcriptCost([first, last])).toBe(15);
  });

  it("без разделения записи в кэш она считается пятиминутной; неизвестная модель — по цене sonnet, как в Token Usage", () => {
    const line = assistant("m2", "r2", "some-model", { input_tokens: 0, cache_creation_input_tokens: 1_000_000, output_tokens: 0 });
    expect(transcriptCost([line])).toBe(3.75);
  });

  it("строки не ответа ассистента и битые строки пропускаются; без расхода — стоимости нет", () => {
    expect(transcriptCost(["не json", JSON.stringify({ type: "user", message: {} })])).toBeUndefined();
  });

  it("длительность — целые минуты от создания треда до брифа, ожидание владельца тоже в счёт", () => {
    expect(planningMinutes(0, 42 * 60_000 + 20_000)).toBe(42);
    expect(planningMinutes(1000, 500)).toBe(0);
  });
});

describe("планирование в бюджете брифа", () => {
  const brief: DecisionBrief = {
    id: "dec_1",
    threadId: "thr_1",
    title: "Бриф",
    createdAt: "2026-09-13T00:00:00.000Z",
    kind: "brief",
    planning: { minutes: 42, cost: 4.2 },
    setup: { criteria: [{ text: "Кнопка", add: { target: 3, max: 5, risk: 1 } }] },
    questions: [],
  };
  const answer = { briefId: brief.id, answers: [], criteria: { removed: [], edited: [], added: [] } };

  it("бриф только с планированием держит прогноз, а реплика агенту называет бюджет без цены треда", () => {
    expect(hasForecast({ ...brief, setup: undefined })).toBe(true);
    expect(answerMessageText(brief, answer)).toContain("Бюджет — прогноз $3 · до $5, риск +1");
  });
});

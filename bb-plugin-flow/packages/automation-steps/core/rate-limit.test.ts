import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { rateLimitError } from "./rate-limit";
import { classifyFailure } from "./retry";

const RESET = 1_790_200_000;
const hhmm = (at: Date): string => `at:${at.getTime()}`;

describe("rateLimitError", () => {
  it("403 с нулевым остатком → текст с временем сброса по часам владельца", () => {
    expect(rateLimitError({ status: 403, remaining: "0", reset: String(RESET) }, hhmm)).toBe(`Лимит GitHub API исчерпан, сбросится в at:${RESET * 1000}`);
  });

  it("429 с нулевым остатком → тот же текст", () => {
    expect(rateLimitError({ status: 429, remaining: "0", reset: String(RESET) }, hhmm)).toBe(`Лимит GitHub API исчерпан, сбросится в at:${RESET * 1000}`);
  });

  it("без времени сброса → текст без времени", () => {
    expect(rateLimitError({ status: 403, remaining: "0", reset: null }, hhmm)).toBe("Лимит GitHub API исчерпан, сбросится в течение часа");
  });

  it("403 с остатком — это права, а не лимит", () => {
    expect(rateLimitError({ status: 403, remaining: "12", reset: String(RESET) }, hhmm)).toBeNull();
  });

  it("403 без заголовков лимита — не лимит", () => {
    expect(rateLimitError({ status: 403, remaining: null, reset: null }, hhmm)).toBeNull();
  });

  it("успешный ответ на последнем запросе квоты — не ошибка", () => {
    expect(rateLimitError({ status: 200, remaining: "0", reset: String(RESET) }, hhmm)).toBeNull();
  });

  it("свойство: текст лимита — постоянная ошибка, слой повторов не тратит на неё квоту", () => {
    fc.assert(
      fc.property(fc.constantFrom(403, 429), fc.option(fc.integer({ min: 0, max: 2 ** 31 }).map(String), { nil: null }), (status, reset) => {
        const text = rateLimitError({ status, remaining: "0", reset }, (at) => at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }));
        expect(text).not.toBeNull();
        expect(classifyFailure(text as string)).toBe("permanent");
      }),
    );
  });
});

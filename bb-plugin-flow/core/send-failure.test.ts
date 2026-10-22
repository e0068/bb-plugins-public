import { describe, expect, it } from "vitest";

import { SEND_RETRY_DELAYS_MS, retryable, sendFailureOf } from "./send-failure";

const withCode = (message: string, code: string) => Object.assign(new Error(message), { code });

describe("причина сбоя отправки брифа", () => {
  it("обрыв сети — нет связи с bb", () => {
    expect(sendFailureOf(new TypeError("Load failed"))).toEqual({ kind: "offline" });
    expect(sendFailureOf(new TypeError("Failed to fetch"))).toEqual({ kind: "offline" });
  });

  it("таймаут bb или его прокси — bb не ответил", () => {
    expect(sendFailureOf(withCode("Timed out waiting for command result", "command_timeout"))).toEqual({ kind: "timeout" });
    expect(sendFailureOf(new Error('rpc "answerBrief" failed (HTTP 504)'))).toEqual({ kind: "timeout" });
    expect(sendFailureOf(new Error('rpc "answerBrief" failed (HTTP 502)'))).toEqual({ kind: "timeout" });
  });

  it("отказ сервера — его слова", () => {
    expect(sendFailureOf(new Error("the provider differs from the thread's"))).toEqual({ kind: "rejected", message: "the provider differs from the thread's" });
    expect(sendFailureOf("строка")).toEqual({ kind: "rejected", message: "строка" });
  });

  it("повторяются обрыв и таймаут, отказ — нет", () => {
    expect(retryable({ kind: "offline" })).toBe(true);
    expect(retryable({ kind: "timeout" })).toBe(true);
    expect(retryable({ kind: "rejected", message: "нет" })).toBe(false);
  });

  it("повторы укладываются в полминуты", () => {
    const total = SEND_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);
    expect(total).toBeGreaterThan(20_000);
    expect(total).toBeLessThanOrEqual(30_000);
  });
});

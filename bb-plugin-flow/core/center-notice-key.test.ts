// @vitest-environment node
import { describe, expect, it } from "vitest";
import { awaitingKey, turnEndEntry } from "./center-notice";

describe("awaitingKey", () => {
  it("ключ записи «Ждёт ответа» — тот, что отзыв берёт у брифа", () => {
    const brief = { id: "dec_7", title: "Бриф" };
    expect(turnEndEntry({ threadId: "thr_1", threadTitle: null, brief }).dedupeKey).toBe(awaitingKey(brief.id));
  });

  it("у разных брифов разные ключи, у одного — один", () => {
    expect(awaitingKey("dec_1")).toBe(awaitingKey("dec_1"));
    expect(awaitingKey("dec_1")).not.toBe(awaitingKey("dec_2"));
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";

import { OWN_SENDS_CAP, createOwnSends } from "./own-sends";

describe("отправки самого Flow", () => {
  it("отмеченная отправка узнаётся, пока не ушла, — и на повторных проходах хука тоже", () => {
    const own = createOwnSends();
    own.mark("thr_1", "Демонстрация — продолжить");
    expect(own.has("thr_1", "Демонстрация — продолжить")).toBe(true);
    expect(own.has("thr_1", "Демонстрация — продолжить")).toBe(true);
  });

  it("чужой тред и чужой текст не узнаются", () => {
    const own = createOwnSends();
    own.mark("thr_1", "текст");
    expect(own.has("thr_2", "текст")).toBe(false);
    expect(own.has("thr_1", "другой")).toBe(false);
  });

  it("ушедшая отправка забывается", () => {
    const own = createOwnSends();
    own.mark("thr_1", "текст");
    own.forget("thr_1", "текст");
    expect(own.has("thr_1", "текст")).toBe(false);
  });

  it("память ограничена: старейшая отметка вытесняется новой", () => {
    const own = createOwnSends();
    for (let i = 0; i <= OWN_SENDS_CAP; i += 1) own.mark("thr_1", `текст ${i}`);
    expect(own.has("thr_1", "текст 0")).toBe(false);
    expect(own.has("thr_1", `текст ${OWN_SENDS_CAP}`)).toBe(true);
  });
});

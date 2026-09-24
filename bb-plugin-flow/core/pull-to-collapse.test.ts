import { describe, expect, it } from "vitest";

import { PULL_CLOSE_RATIO, pullOffset, settlesClosed } from "./pull-to-collapse";

describe("список едет за пальцем", () => {
  it("от самого верха список уезжает ровно на пройденное пальцем", () => {
    expect(pullOffset({ scrollTop: 0, movedDown: 30, height: 200 })).toBe(30);
    expect(pullOffset({ scrollTop: 0, movedDown: 120, height: 200 })).toBe(120);
  });

  it("дальше своей высоты список не уезжает", () => {
    expect(pullOffset({ scrollTop: 0, movedDown: 500, height: 200 })).toBe(200);
  });

  it("палец вверх список не тянет", () => {
    expect(pullOffset({ scrollTop: 0, movedDown: -80, height: 200 })).toBe(0);
  });

  it("пока список не в самом верху, палец его листает и баннер не тянет", () => {
    expect(pullOffset({ scrollTop: 1, movedDown: 120, height: 200 })).toBe(0);
  });

  it("резиновая перетяжка выше верха считается верхом", () => {
    expect(pullOffset({ scrollTop: -20, movedDown: 30, height: 200 })).toBe(30);
  });
});

describe("отпущенный палец", () => {
  it("после четверти высоты оставляет баннер закрытым", () => {
    expect(settlesClosed({ offset: 200 * PULL_CLOSE_RATIO, height: 200 })).toBe(true);
    expect(settlesClosed({ offset: 190, height: 200 })).toBe(true);
  });

  it("раньше четверти высоты возвращает список на место", () => {
    expect(settlesClosed({ offset: 200 * PULL_CLOSE_RATIO - 1, height: 200 })).toBe(false);
    expect(settlesClosed({ offset: 0, height: 200 })).toBe(false);
  });

  it("список без высоты баннер не закрывает", () => {
    expect(settlesClosed({ offset: 0, height: 0 })).toBe(false);
  });
});

// @vitest-environment node
// Переход в другой flow — третий исход Демонстрации: выбранный flow сильнее и «Продолжить», и комментария —
// комментарий уезжает в новый flow вместе с переходом.
import { describe, expect, it } from "vitest";

import { demoVerdict } from "./outcome";

const bug = { id: "flow-bug", name: "Bug" };

describe("исход Демонстрации с выбранным flow", () => {
  it("выбранный flow — переход, с комментарием и без", () => {
    expect(demoVerdict({ outcome: { accepted: false, flow: bug } })).toBe("switch");
    expect(demoVerdict({ outcome: { accepted: false, note: "только первую находку", flow: bug } })).toBe("switch");
  });

  it("без выбранного flow исходы прежние", () => {
    expect(demoVerdict({ outcome: { accepted: true } })).toBe("continue");
    expect(demoVerdict({ outcome: { accepted: false, note: "почему так?" } })).toBe("comment");
  });
});

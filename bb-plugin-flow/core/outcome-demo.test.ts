// @vitest-environment node
import { describe, expect, it } from "vitest";

import { demoVerdict } from "./outcome";

describe("исход Демонстрации", () => {
  it("комментарий не принимает Демонстрацию: принятая — «продолжить», непринятая с комментарием — «комментарий»", () => {
    expect(demoVerdict({ outcome: { accepted: true } })).toBe("continue");
    expect(demoVerdict({ outcome: { accepted: true, note: "учти подпись" } })).toBe("continue");
    expect(demoVerdict({ outcome: { accepted: false, note: "почему баннер ниже?" } })).toBe("comment");
    expect(demoVerdict({ outcome: { accepted: false, note: "  " } })).toBeNull();
    expect(demoVerdict({})).toBeNull();
  });
});

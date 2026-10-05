import { describe, expect, it } from "vitest";

import { DEFAULT_COMPACT_PRESELECT, compactPreselectOf } from "./context";

describe("предвыбор компактации по умолчанию", () => {
  it("по умолчанию — с жёлтой зоны", () => {
    expect(DEFAULT_COMPACT_PRESELECT).toBe("warn");
  });

  it.each([undefined, null, 1, "", "Always"])("непонятное значение настройки %j — умолчание", (value) => {
    expect(compactPreselectOf(value)).toBe("warn");
  });
});

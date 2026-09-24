// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ALERT_PERCENT,
  DEFAULT_CONTEXT_THRESHOLDS,
  DEFAULT_WARN_PERCENT,
  contextPercent,
  contextShare,
  contextTone,
  thresholdsOrDefault,
  shortTokens,
} from "./context";

describe("доля занятого окна", () => {
  it("делит занятое на окно", () => {
    expect(contextShare(163_000, 900_000)).toBeCloseTo(0.1811, 4);
  });

  it("окно не положительное — делить не на что", () => {
    expect(contextShare(100, 0)).toBeNull();
    expect(contextShare(100, -1)).toBeNull();
  });

  it("нечисло — доли нет", () => {
    expect(contextShare(Number.NaN, 900_000)).toBeNull();
    expect(contextShare(100, Number.NaN)).toBeNull();
  });

  it("занятое сверх окна обрезается единицей, а не переполняет полосу", () => {
    expect(contextShare(1_200_000, 1_000_000)).toBe(1);
  });

  it("отрицательное занятое — ноль", () => {
    expect(contextShare(-5, 1_000_000)).toBe(0);
  });

  it("доля всегда в 0..1 либо её нет", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true }), fc.double({ noNaN: true }), (used, window) => {
        const share = contextShare(used, window);
        return share === null || (share >= 0 && share <= 1);
      }),
    );
  });
});

describe("процент занятого", () => {
  it("округляется до целого — того же, что стоит в подписи", () => {
    expect(contextPercent(0.2451)).toBe(25);
    expect(contextPercent(0.1811)).toBe(18);
  });

  it("всегда целое в 0..100", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true }), (share) => {
        const percent = contextPercent(share);
        return Number.isInteger(percent) && percent >= 0 && percent <= 100;
      }),
    );
  });
});

describe("пара порогов", () => {
  it("жёлтый меньше красного — пара принимается как есть", () => {
    expect(thresholdsOrDefault(12, 55)).toEqual({ warnPercent: 12, alertPercent: 55 });
  });

  it("перевёрнутая пара — умолчание целиком, а не молчаливый разворот", () => {
    expect(thresholdsOrDefault(40, 25)).toEqual(DEFAULT_CONTEXT_THRESHOLDS);
  });

  it("перевёрнутая пара не разворачивается: 50 и 30 дают умолчание, а не 30 и 50", () => {
    expect(thresholdsOrDefault(50, 30)).toEqual(DEFAULT_CONTEXT_THRESHOLDS);
  });

  it("равные пороги бессмысленны — умолчание", () => {
    expect(thresholdsOrDefault(30, 30)).toEqual(DEFAULT_CONTEXT_THRESHOLDS);
  });

  it("за пределами шкалы — умолчание", () => {
    expect(thresholdsOrDefault(-10, 40)).toEqual(DEFAULT_CONTEXT_THRESHOLDS);
    expect(thresholdsOrDefault(25, 300)).toEqual(DEFAULT_CONTEXT_THRESHOLDS);
  });

  it("не число — умолчание", () => {
    expect(thresholdsOrDefault(Number.NaN, undefined)).toEqual(DEFAULT_CONTEXT_THRESHOLDS);
    expect(thresholdsOrDefault("двадцать", null)).toEqual(DEFAULT_CONTEXT_THRESHOLDS);
  });

  it("по умолчанию жёлтый с 25 процентов, красный с 40", () => {
    expect(DEFAULT_WARN_PERCENT).toBe(25);
    expect(DEFAULT_ALERT_PERCENT).toBe(40);
  });

  it("на любом входе пара осмысленна: жёлтый строго меньше красного и оба на шкале", () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (warn, alert) => {
        const { warnPercent, alertPercent } = thresholdsOrDefault(warn, alert);
        return warnPercent < alertPercent && warnPercent >= 0 && alertPercent <= 100;
      }),
    );
  });
});

describe("тон полосы по порогам", () => {
  const thresholds = { warnPercent: 25, alertPercent: 40 };

  it("до жёлтого порога — обычный тон", () => {
    expect(contextTone(24, thresholds)).toBe("normal");
  });

  it("порог входит в свою полосу", () => {
    expect(contextTone(25, thresholds)).toBe("warn");
    expect(contextTone(40, thresholds)).toBe("alert");
  });

  it("между порогами — жёлтый", () => {
    expect(contextTone(39, thresholds)).toBe("warn");
  });

  it("тон не убывает с ростом занятого", () => {
    const rank = { normal: 0, warn: 1, alert: 2 };
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        return rank[contextTone(low, thresholds)] <= rank[contextTone(high, thresholds)];
      }),
    );
  });
});

describe("токены коротко", () => {
  it("тысячи и миллионы — как их пишет bb", () => {
    expect(shortTokens(163_000)).toBe("163k");
    expect(shortTokens(900_000)).toBe("900k");
    expect(shortTokens(1_000_000)).toBe("1M");
    expect(shortTokens(1_250_000)).toBe("1.3M");
    expect(shortTokens(950)).toBe("950");
  });
});

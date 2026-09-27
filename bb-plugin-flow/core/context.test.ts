// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ALERT_TOKENS,
  DEFAULT_CONTEXT_THRESHOLDS,
  DEFAULT_WARN_TOKENS,
  contextPercent,
  contextSegments,
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

describe("пара порогов в токенах", () => {
  it("жёлтый меньше красного — пара принимается как есть", () => {
    expect(thresholdsOrDefault(120_000, 550_000)).toEqual({ warnTokens: 120_000, alertTokens: 550_000 });
  });

  it("перевёрнутая пара — умолчание целиком, а не молчаливый разворот", () => {
    expect(thresholdsOrDefault(500_000, 300_000)).toEqual(DEFAULT_CONTEXT_THRESHOLDS);
  });

  it("равные пороги бессмысленны — умолчание", () => {
    expect(thresholdsOrDefault(300_000, 300_000)).toEqual(DEFAULT_CONTEXT_THRESHOLDS);
  });

  it("отрицательный порог — умолчание", () => {
    expect(thresholdsOrDefault(-10, 400_000)).toEqual(DEFAULT_CONTEXT_THRESHOLDS);
  });

  it("не число — умолчание", () => {
    expect(thresholdsOrDefault(Number.NaN, undefined)).toEqual(DEFAULT_CONTEXT_THRESHOLDS);
    expect(thresholdsOrDefault("двадцать", null)).toEqual(DEFAULT_CONTEXT_THRESHOLDS);
    expect(thresholdsOrDefault(250_000, Number.POSITIVE_INFINITY)).toEqual(DEFAULT_CONTEXT_THRESHOLDS);
  });

  it("по умолчанию жёлтый с 250 000 токенов, красный с 400 000", () => {
    expect(DEFAULT_WARN_TOKENS).toBe(250_000);
    expect(DEFAULT_ALERT_TOKENS).toBe(400_000);
  });

  it("на любом входе пара осмысленна: жёлтый строго меньше красного, оба не отрицательны", () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (warn, alert) => {
        const { warnTokens, alertTokens } = thresholdsOrDefault(warn, alert);
        return warnTokens >= 0 && warnTokens < alertTokens && Number.isFinite(alertTokens);
      }),
    );
  });
});

describe("тон полосы по занятым токенам", () => {
  const thresholds = { warnTokens: 250_000, alertTokens: 400_000 };

  it("до жёлтого порога — обычный тон", () => {
    expect(contextTone(249_999, thresholds)).toBe("normal");
  });

  it("порог входит в свою полосу", () => {
    expect(contextTone(250_000, thresholds)).toBe("warn");
    expect(contextTone(400_000, thresholds)).toBe("alert");
  });

  it("между порогами — жёлтый", () => {
    expect(contextTone(399_999, thresholds)).toBe("warn");
  });

  it("тон не зависит от окна: 300k жёлтые и в окне 1M, и в окне 2M", () => {
    expect(contextTone(300_000, thresholds)).toBe("warn");
  });

  it("тон не убывает с ростом занятого", () => {
    const rank = { normal: 0, warn: 1, alert: 2 };
    fc.assert(
      fc.property(fc.nat(), fc.nat(), (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        return rank[contextTone(low, thresholds)] <= rank[contextTone(high, thresholds)];
      }),
    );
  });
});

describe("отрезки полосы по порогам", () => {
  const thresholds = { warnTokens: 250_000, alertTokens: 400_000 };

  it("оба порога внутри окна — три отрезка, границы на пороге ÷ окно", () => {
    const sizes = contextSegments(0, 1_000_000, thresholds).map((s) => s.size);
    expect(sizes).toHaveLength(3);
    [0.25, 0.15, 0.6].forEach((size, index) => expect(sizes[index]).toBeCloseTo(size, 10));
  });

  it("красный порог за окном — два отрезка, его граница не рисуется", () => {
    const segments = contextSegments(0, 300_000, thresholds);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.size).toBeCloseTo(250_000 / 300_000, 10);
  });

  it("порог ровно на окне своей границы не рисует", () => {
    expect(contextSegments(0, 400_000, thresholds)).toHaveLength(2);
  });

  it("оба порога за окном — один отрезок во всю длину", () => {
    expect(contextSegments(0, 200_000, thresholds)).toEqual([{ size: 1, filled: 0 }]);
  });

  it("нулевой порог не рождает пустой отрезок в начале", () => {
    expect(contextSegments(0, 1_000_000, { warnTokens: 0, alertTokens: 400_000 }).map((s) => s.size)).toEqual([0.4, 0.6]);
  });

  it("заполненность раскладывается по отрезкам: до занятого — полные, дальше — пустые", () => {
    const segments = contextSegments(325_000, 1_000_000, thresholds);
    expect(segments.map((s) => s.filled)).toEqual([1, 0.5, 0]);
  });

  it("окно не положительное — отрезков нет", () => {
    expect(contextSegments(100, 0, thresholds)).toEqual([]);
  });

  it("отрезки покрывают всю полосу, а заливка в сумме равна доле занятого", () => {
    fc.assert(
      fc.property(fc.nat(2_000_000), fc.integer({ min: 1, max: 2_000_000 }), fc.nat(1_000_000), fc.integer({ min: 1, max: 1_000_000 }), (used, window, warn, gap) => {
        const segments = contextSegments(used, window, { warnTokens: warn, alertTokens: warn + gap });
        const total = segments.reduce((sum, s) => sum + s.size, 0);
        const filled = segments.reduce((sum, s) => sum + s.size * s.filled, 0);
        return (
          segments.length >= 1 &&
          segments.length <= 3 &&
          segments.every((s) => s.size > 0 && s.filled >= 0 && s.filled <= 1) &&
          Math.abs(total - 1) < 1e-9 &&
          Math.abs(filled - Math.min(1, used / window)) < 1e-9
        );
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

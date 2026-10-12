// @vitest-environment node
// Сумма строк прогноза — цена свёрнутой строки вложенного flow: неизвестное не становится нулём.
import { describe, expect, it } from "vitest";

import { linesSum, type ForecastLine } from "./budget";

const line = (minutes: number | null, target: number | null, risk = 1): ForecastLine => ({ label: "", note: "", minutes, risk, target, max: target === null ? null : target * 2 });

describe("linesSum", () => {
  it("складывает риск, минуты и деньги строк", () => {
    expect(linesSum([line(5, 1.1), line(7, 2.2, 2)])).toEqual({ risk: 3, minutes: 12, target: 3.3, max: 6.6 });
  });

  it("строка без минут не превращает их в ноль: ни у одной нет — минут нет", () => {
    expect(linesSum([line(null, 1), line(null, 2)])?.minutes).toBeNull();
    expect(linesSum([line(null, 1), line(4, 2)])?.minutes).toBe(4);
  });

  it("без строк цены нет", () => {
    expect(linesSum([])).toBeUndefined();
  });
});

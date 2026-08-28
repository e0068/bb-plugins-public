import { describe, expect, it } from "vitest";
import { clampWidth, nextWidthFromDrag } from "./geometry";

describe("clampWidth", () => {
  it("держит значение в границах", () => {
    expect(clampWidth(500, 320, 900)).toBe(500);
    expect(clampWidth(100, 320, 900)).toBe(320);
    expect(clampWidth(1200, 320, 900)).toBe(900);
  });

  it("границы включительны", () => {
    expect(clampWidth(320, 320, 900)).toBe(320);
    expect(clampWidth(900, 320, 900)).toBe(900);
  });

  it("NaN/Infinity → минимум", () => {
    expect(clampWidth(Number.NaN, 320, 900)).toBe(320);
    expect(clampWidth(Number.POSITIVE_INFINITY, 320, 900)).toBe(900);
    expect(clampWidth(Number.NEGATIVE_INFINITY, 320, 900)).toBe(320);
  });
});

describe("nextWidthFromDrag (правый пан, ручка слева)", () => {
  it("тянем ручку влево — пан шире", () => {
    // старт 400, курсор ушёл с x=1000 на x=900 (влево на 100) → +100
    expect(nextWidthFromDrag(400, 1000, 900, 320, 900)).toBe(500);
  });

  it("тянем ручку вправо — пан уже", () => {
    // курсор с 1000 на 1100 (вправо на 100) → -100
    expect(nextWidthFromDrag(400, 1000, 1100, 320, 900)).toBe(320);
  });

  it("без движения — ширина не меняется", () => {
    expect(nextWidthFromDrag(555, 1000, 1000, 320, 900)).toBe(555);
  });

  it("результат зажат по максимуму", () => {
    expect(nextWidthFromDrag(880, 1000, 500, 320, 900)).toBe(900);
  });
});

describe("nextWidthFromDrag (левый пан, ручка справа)", () => {
  it("тянем ручку вправо — пан шире", () => {
    // курсор с 300 на 400 (вправо на 100) → +100
    expect(nextWidthFromDrag(280, 300, 400, 200, 520, "left")).toBe(380);
  });

  it("тянем ручку влево — пан уже", () => {
    // курсор с 300 на 200 (влево на 100) → -100
    expect(nextWidthFromDrag(280, 300, 200, 200, 520, "left")).toBe(200);
  });

  it("знак противоположен правому пану при том же движении", () => {
    const drag = { start: 400, from: 1000, to: 900 };
    const right = nextWidthFromDrag(drag.start, drag.from, drag.to, 100, 900);
    const left = nextWidthFromDrag(drag.start, drag.from, drag.to, 100, 900, "left");
    expect(right).toBe(500); // +100
    expect(left).toBe(300); // -100
  });
});

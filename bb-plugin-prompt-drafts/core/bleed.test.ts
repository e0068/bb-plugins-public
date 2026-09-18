// @vitest-environment node
import { describe, expect, it } from "vitest";
import { edgeBleed } from "./bleed";

describe("выход ряда за колонку", () => {
  it("с каждой стороны доходит до той же стороны обрезающего блока", () => {
    expect(edgeBleed({ left: 300, right: 1060 }, { left: 100, right: 1400 })).toEqual({ left: 200, right: 340 });
  });

  it("равен нулю, когда колонка уже во всю ширину блока", () => {
    expect(edgeBleed({ left: 0, right: 800 }, { left: 0, right: 800 })).toEqual({ left: 0, right: 0 });
  });

  it("округляется вниз до целых пикселей и не перелезает за блок на дробь", () => {
    expect(edgeBleed({ left: 200.6, right: 960.4 }, { left: 0, right: 1161 })).toEqual({ left: 200, right: 200 });
  });

  it("не уходит в минус, когда колонка шире блока", () => {
    expect(edgeBleed({ left: 50, right: 900 }, { left: 100, right: 800 })).toEqual({ left: 0, right: 0 });
  });
});

// @vitest-environment node
// Видимая область начинается ниже края окна — под шапкой bb: всплывашка над полем не заходит под шапку.
import { describe, expect, it } from "vitest";

import { popoverPlace, visibleTop } from "./popover-place";

const field = (top: number) => ({ top, bottom: top + 28, left: 100 });

describe("всплывашка поля под шапкой", () => {
  it("вверх — не выше нижнего края шапки: потолок считается от него, с тем же отступом в 8 px", () => {
    const place = popoverPlace(field(500), { width: 320, height: 2000 }, { width: 1000, height: 800, top: 60 });
    // Над полем 500 − 60 − 4 − 8 = 428, под ним 800 − 528 − 4 − 8 = 260: вверх.
    expect(place).toEqual({ up: true, dx: 0, maxHeight: 428 });
  });

  it("под высокой шапкой места сверху меньше, чем снизу, — открывается вниз", () => {
    const place = popoverPlace(field(500), { width: 320, height: 2000 }, { width: 1000, height: 800, top: 300 });
    // Без шапки над полем 488 — больше, чем 260 под ним; с шапкой в 300 px над полем 188: вниз.
    expect(place).toEqual({ up: false, dx: 0, maxHeight: 260 });
  });
});

describe("верх видимой части над полем", () => {
  it("предков, обрезающих содержимое, нет — край окна", () => {
    expect(visibleTop([{ clips: false, top: 120 }, { clips: false, top: 0 }])).toBe(0);
  });

  it("берётся край ближайшего обрезающего предка — прокрутки страницы под шапкой", () => {
    expect(visibleTop([{ clips: false, top: 300 }, { clips: true, top: 56 }, { clips: true, top: 0 }])).toBe(56);
  });

  it("предок, прокрученный выше края окна, — край окна", () => {
    expect(visibleTop([{ clips: true, top: -40 }])).toBe(0);
  });
});

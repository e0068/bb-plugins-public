// @vitest-environment node
import { describe, expect, it } from "vitest";

import { popoverPlace } from "./popover-place";

const WINDOW = { width: 1000, height: 800 };
const field = (top: number, left = 100) => ({ top, bottom: top + 28, left });

describe("всплывашка поля в окне", () => {
  it("места под полем хватает — открывается вниз, на месте, без сдвига", () => {
    expect(popoverPlace(field(100), { width: 320, height: 300 }, WINDOW)).toEqual({ up: false, dx: 0, maxHeight: 560 });
  });

  it("у нижнего края, когда сверху места больше, — открывается вверх", () => {
    const place = popoverPlace(field(700), { width: 320, height: 400 }, WINDOW);
    expect(place.up).toBe(true);
    expect(place.maxHeight).toBe(560);
  });

  it("не выше 70% окна, даже когда места больше", () => {
    expect(popoverPlace(field(0), { width: 320, height: 2000 }, WINDOW).maxHeight).toBe(560);
  });

  it("высота не больше места с выбранной стороны: край окна в 8 px от края всплывашки", () => {
    const place = popoverPlace(field(500), { width: 320, height: 2000 }, WINDOW);
    // Над полем 500 − 4 − 8 = 488, под ним 800 − 528 − 4 − 8 = 260: вверх.
    expect(place).toEqual({ up: true, dx: 0, maxHeight: 488 });
  });

  it("у правого края сдвигается влево ровно настолько, чтобы остаться в 8 px от края", () => {
    expect(popoverPlace(field(100, 800), { width: 320, height: 100 }, WINDOW).dx).toBe(-128);
  });
});

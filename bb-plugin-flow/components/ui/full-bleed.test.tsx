// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FullBleed, bleedOf } from "./full-bleed";

describe("растяжка на ширину ленты", () => {
  it("колонка уже ленты — сдвиг влево до края ленты с отступом и ширина ленты без двух отступов", () => {
    expect(bleedOf({ left: 0, width: 1200 }, { left: 236, width: 728 }, 16)).toEqual({ left: -220, width: 1168 });
  });

  it("колонка во всю ленту — ни сдвига, ни лишней ширины", () => {
    expect(bleedOf({ left: 0, width: 760 }, { left: 16, width: 728 }, 16)).toEqual({ left: 0, width: 728 });
  });

  it("без прокручиваемой ленты над собой растяжка остаётся шириной колонки", () => {
    const { container } = render(<FullBleed>окно</FullBleed>);
    const box = container.firstElementChild as HTMLElement;
    expect(box.style.getPropertyValue("--bleed-left")).toBe("");
    expect(box.textContent).toBe("окно");
  });
});

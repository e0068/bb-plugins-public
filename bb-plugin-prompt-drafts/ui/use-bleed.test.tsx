// @vitest-environment jsdom
//
// Обещание оболочки: ряд тянется от колонки, в которой стоит, до краёв
// обрезающего блока. bb кладёт поверхность плагина в обёртку `display: contents`
// — своей коробки у неё нет, и мерить выход от неё нельзя.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { useBleed } from "./use-bleed";

afterEach(cleanup);

class StillResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StillResizeObserver);
  return () => vi.unstubAllGlobals();
});

function placeAt(element: HTMLElement, left: number, width: number): void {
  element.getBoundingClientRect = () => new DOMRect(left, 0, width, 10);
  Object.defineProperty(element, "clientWidth", { value: width });
}

function Row() {
  const rowRef = useRef<HTMLDivElement>(null);
  const bleed = useBleed(rowRef, true);
  return <div ref={rowRef} data-left={bleed.left} data-right={bleed.right} />;
}

describe("useBleed", () => {
  it("меряет выход от колонки, а не от обёртки display: contents вокруг ряда", () => {
    const clip = document.createElement("div");
    clip.style.overflowX = "auto";
    const column = document.createElement("div");
    const wrapper = document.createElement("div");
    wrapper.style.display = "contents";
    clip.append(column);
    column.append(wrapper);
    document.body.append(clip);
    placeAt(clip, 320, 1192);
    placeAt(column, 552, 728);
    placeAt(wrapper, 0, 0);

    const { container } = render(<Row />, { container: wrapper });

    const row = container.firstElementChild as HTMLElement;
    expect([row.dataset.left, row.dataset.right]).toEqual(["232", "232"]);
    clip.remove();
  });
});

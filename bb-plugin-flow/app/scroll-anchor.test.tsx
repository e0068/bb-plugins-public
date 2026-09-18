// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useScrollAnchor } from "./scroll-anchor";

afterEach(cleanup);

/** Лента хоста: прокручиваемый контейнер заданной высоты и прокрутки. */
const feed = (element: HTMLElement, box: { scrollHeight: number; clientHeight: number; scrollTop: number }) => {
  let top = box.scrollTop;
  Object.defineProperty(element, "scrollHeight", { configurable: true, get: () => box.scrollHeight });
  Object.defineProperty(element, "clientHeight", { configurable: true, get: () => box.clientHeight });
  Object.defineProperty(element, "scrollTop", { configurable: true, get: () => top, set: (v: number) => void (top = v) });
  element.style.overflowY = "auto";
  const wheels: WheelEvent[] = [];
  element.addEventListener("wheel", (e) => wheels.push(e as WheelEvent));
  return { wheels, top: () => top };
};

function Expander() {
  const anchor = useScrollAnchor();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={(e) => {
          anchor(e.currentTarget);
          setOpen((o) => !o);
        }}
      >
        Бюджет
      </button>
      {open && <div>раскрыто</div>}
    </div>
  );
}

const mount = (box: { scrollHeight: number; clientHeight: number; scrollTop: number }) => {
  const scroller = document.createElement("div");
  document.body.append(scroller);
  const probe = feed(scroller, box);
  const view = render(<Expander />, { container: scroller.appendChild(document.createElement("div")) });
  return { ...probe, button: view.getByRole("button", { name: "Бюджет" }) };
};

describe("раскрытие кнопки брифа у низа ленты", () => {
  it("снимает прижатие хоста: колесо вверх и прокрутка дальше порога в 4px от низа", () => {
    const { wheels, top, button } = mount({ scrollHeight: 2000, clientHeight: 800, scrollTop: 1200 });
    fireEvent.click(button);
    expect(wheels).toHaveLength(1);
    expect(wheels[0]!.deltaY).toBeLessThan(0);
    expect(2000 - 800 - top()).toBeGreaterThan(4);
  });

  it("вдали от низа прокрутку не трогает и колеса не шлёт", () => {
    const { wheels, top, button } = mount({ scrollHeight: 2000, clientHeight: 800, scrollTop: 300 });
    fireEvent.click(button);
    expect(wheels).toHaveLength(0);
    expect(top()).toBe(300);
  });
});

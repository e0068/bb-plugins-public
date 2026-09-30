// Обещания монтажника Kit о меню kit: своё меню закрывается при размонтировании
// у любой фабрики, чужие меню при пересоздании элемента остаются открытыми.
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { button, input, segment } from "../cellular-kit";
import { Kit } from "./Kit";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const menu = { items: [{ label: "Ascending" }] };

describe("Kit — меню kit", () => {
  it("меню поля ввода, открытое фокусом, закрывается при размонтировании", () => {
    vi.useFakeTimers();
    const { unmount } = render(<Kit make={input} props={{ placeholder: "Search", hasMenu: true, menu }} />);
    screen.getByPlaceholderText("Search").focus();
    vi.runAllTimers();
    expect(document.body.querySelector(".lfomenu")).not.toBeNull();
    unmount();
    expect(document.body.querySelector(".lfomenu")).toBeNull();
  });

  it("пересоздание сегмента не закрывает открытое меню соседней кнопки", () => {
    vi.useFakeTimers();
    const items = [{ label: "Плашки" }, { label: "Линии" }];
    const { rerender } = render(
      <>
        <Kit make={button} props={{ label: "Sort", hasMenu: true, menu }} />
        <Kit make={segment} props={{ items, value: 0 }} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    vi.runAllTimers();
    expect(document.body.querySelector(".lfomenu")).not.toBeNull();
    rerender(
      <>
        <Kit make={button} props={{ label: "Sort", hasMenu: true, menu }} />
        <Kit make={segment} props={{ items, value: 1 }} />
      </>,
    );
    expect(screen.getByRole("button", { name: "Линии" })).toHaveClass("on");
    expect(document.body.querySelector(".lfomenu")).not.toBeNull();
  });

  it("клик по пункту меню кнопки зовёт его onSelect и закрывает меню", () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    render(<Kit make={button} props={{ label: "Sort", hasMenu: true, menu: { items: [{ label: "Ascending", onSelect }] } }} />);
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    vi.runAllTimers();
    fireEvent.click(screen.getByRole("button", { name: "Ascending" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector(".lfomenu")).toBeNull();
  });

  it("уборка с открытым меню кнопки не выглядит кликом снаружи для слоя, в котором стоит Kit", () => {
    // Слой Radix слушает pointerdown на документе и закрывается, если цель вне него.
    vi.useFakeTimers();
    const outside: boolean[] = [];
    const layer = document.createElement("div");
    document.body.appendChild(layer);
    const watch = (e: Event) => outside.push(!layer.contains(e.target as Node));
    document.addEventListener("pointerdown", watch);
    try {
      const { unmount } = render(<Kit make={button} props={{ label: "Sort", hasMenu: true, menu }} />, { container: layer });
      fireEvent.click(screen.getByRole("button", { name: "Sort" }));
      vi.runAllTimers();
      unmount();
      expect(document.body.querySelector(".lfomenu")).toBeNull();
      expect(outside).not.toContain(true);
    } finally {
      document.removeEventListener("pointerdown", watch);
      layer.remove();
    }
  });
});

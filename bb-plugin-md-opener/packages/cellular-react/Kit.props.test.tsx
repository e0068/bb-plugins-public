// Обещания монтажника Kit о смене пропсов — для каждой фабрики, а не только для кнопки:
// свежие колбэки, свежие значения, исчезнувший проп исчезает, уборка не трогает документ зря.
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { button, input, segment, toggle } from "../cellular-kit";
import { Kit } from "./Kit";

afterEach(cleanup);

describe("Kit — смена пропсов доходит до каждой фабрики", () => {
  it("сегмент: новое value переносит выделение", () => {
    const items = [{ label: "Плашки" }, { label: "Линии" }];
    const { rerender, container } = render(<Kit make={segment} props={{ items, value: 0 }} />);
    rerender(<Kit make={segment} props={{ items, value: 1 }} />);
    expect(container.querySelector("button.on")).toHaveTextContent("Линии");
  });

  it("переключатель: клик после ререндера попадает в новый set, а не в старый", () => {
    const calls: string[] = [];
    const { rerender } = render(
      <Kit make={toggle} props={{ label: "Managed", get: () => false, set: () => { calls.push("old"); } }} />,
    );
    rerender(<Kit make={toggle} props={{ label: "Managed", get: () => false, set: () => { calls.push("new"); } }} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Managed" }));
    expect(calls).toEqual(["new"]);
  });

  it("переключатель: изменившийся ответ get() виден в чекбоксе", () => {
    let managed = false;
    const props = () => ({ label: "Managed", get: () => managed, set: () => {} });
    const { rerender } = render(<Kit make={toggle} props={props()} />);
    managed = true;
    rerender(<Kit make={toggle} props={props()} />);
    expect(screen.getByRole("checkbox", { name: "Managed" })).toBeChecked();
  });

  it("поле ввода: новый placeholder виден в поле", () => {
    const { rerender } = render(<Kit make={input} props={{ placeholder: "Search" }} />);
    rerender(<Kit make={input} props={{ placeholder: "Search text columns" }} />);
    expect(screen.getByPlaceholderText("Search text columns")).toBeInTheDocument();
  });

  it("кнопка: исчезнувший проп value очищает значение", () => {
    const { rerender, container } = render(<Kit make={button} props={{ label: "rows", value: "1–25" }} />);
    rerender(<Kit make={button} props={{ label: "rows" }} />);
    expect(container.querySelector(".cval")).toHaveTextContent("");
  });

  it("кнопка: клик после ререндера зовёт новый onClick", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Kit make={button} props={{ label: "Count", onClick: first }} />);
    rerender(<Kit make={button} props={{ label: "Count", onClick: second }} />);
    fireEvent.click(screen.getByRole("button", { name: "Count" }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("инлайн-лямбда make не пересоздаёт элемент на ререндере", () => {
    const { rerender, container } = render(<Kit make={(p) => button(p)} props={{ label: "Count" }} />);
    const before = container.querySelector(".uicell");
    rerender(<Kit make={(p) => button(p)} props={{ label: "Count" }} />);
    expect(container.querySelector(".uicell")).toBe(before);
  });
});

describe("Kit — уборка", () => {
  it("размонтирование без открытого меню не шлёт pointerdown в документ", () => {
    const seen = vi.fn();
    document.addEventListener("pointerdown", seen, true);
    try {
      const { unmount } = render(<Kit make={button} props={{ label: "Count" }} />);
      unmount();
      expect(seen).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("pointerdown", seen, true);
    }
  });
});

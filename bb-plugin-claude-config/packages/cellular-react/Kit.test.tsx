// Обещания монтажника Kit: фабрика kit живёт внутри React-дерева, реагирует на клик,
// кнопка (у неё есть _refresh) обновляет значение без пересоздания элемента,
// размонтирование не оставляет следов в body. Смена пропсов у остальных фабрик —
// Kit.props.test.tsx, меню — Kit.menus.test.tsx.
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { button, input, segment, toggle } from "../cellular-kit";
import { Kit } from "./Kit";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Kit — монтажник фабрик kit", () => {
  it("кнопка kit стоит в React-дереве и отвечает на клик", () => {
    const onClick = vi.fn();
    render(<Kit make={button} props={{ label: "Count", onClick }} />);
    fireEvent.click(screen.getByRole("button", { name: "Count" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("смена пропсов обновляет значение кнопки, не пересоздавая элемент", () => {
    const { rerender, container } = render(<Kit make={button} props={{ label: "rows", value: "1–25" }} />);
    const before = container.querySelector(".uicell");
    rerender(<Kit make={button} props={{ label: "rows", value: "26–50" }} />);
    expect(container.querySelector(".uicell")).toBe(before);
    expect(container.querySelector(".cval")).toHaveTextContent("26–50");
  });

  it("размонтирование убирает элемент и закрывает открытое меню kit", () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <Kit make={button} props={{ label: "Sort", hasMenu: true, menu: { items: [{ label: "Ascending" }] } }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    vi.runAllTimers();
    expect(document.body.querySelector(".lfomenu")).not.toBeNull();
    unmount();
    expect(document.body.querySelector(".lfomenu")).toBeNull();
    expect(document.body.querySelector(".uicell")).toBeNull();
  });

  it("сегмент: клик по варианту отдаёт его индекс в onSelect и переносит выделение", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <Kit make={segment} props={{ items: [{ label: "Плашки" }, { label: "Линии" }], value: 0, onSelect }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Линии" }));
    expect(onSelect).toHaveBeenCalledWith(1);
    expect(container.querySelectorAll("button.on")).toHaveLength(1);
    expect(container.querySelector("button.on")).toHaveTextContent("Линии");
  });

  it("переключатель: смена состояния отдаёт новое значение в set", () => {
    let managed = false;
    render(
      <Kit make={toggle} props={{ label: "Managed", get: () => managed, set: (v: boolean) => { managed = v; } }} />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Managed" }));
    expect(managed).toBe(true);
  });

  it("поле ввода: набранный текст читается из поля", () => {
    render(<Kit make={input} props={{ placeholder: "Search text columns" }} />);
    const field = screen.getByPlaceholderText("Search text columns");
    fireEvent.change(field, { target: { value: "env_" } });
    expect(field).toHaveValue("env_");
  });
});

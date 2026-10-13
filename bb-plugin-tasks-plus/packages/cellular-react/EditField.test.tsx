// Обещания EditField: одиночный редактор ячейки на текстовом input kit. Поле
// приходит из компонента (каретка, выделение, стиль .cinp — не переписаны),
// оболочка лишь подставляет начальное значение и держит фокус, а Enter шлёт
// текущий текст, Escape и потеря фокуса закрывают без записи.
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditField } from "./EditField";

afterEach(cleanup);

describe("EditField — редактор ячейки на input kit", () => {
  it("монтирует текстовое поле kit с начальным значением и держит его в фокусе", () => {
    const { container } = render(<EditField value="hello" onCommit={vi.fn()} onCancel={vi.fn()} />);
    const field = container.querySelector("input.cinp") as HTMLInputElement;
    expect(field).toBeTruthy();
    expect(field.value).toBe("hello");
    expect(document.activeElement).toBe(field);
  });

  it("Enter шлёт текущий текст поля в onCommit", () => {
    const onCommit = vi.fn();
    const { container } = render(<EditField value="hello" onCommit={onCommit} onCancel={vi.fn()} />);
    const field = container.querySelector("input.cinp") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "world" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("world");
  });

  it("Escape отменяет без коммита", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(<EditField value="hello" onCommit={onCommit} onCancel={onCancel} />);
    const field = container.querySelector("input.cinp") as HTMLInputElement;
    fireEvent.keyDown(field, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("потеря фокуса отменяет без коммита", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(<EditField value="hello" onCommit={onCommit} onCancel={onCancel} />);
    const field = container.querySelector("input.cinp") as HTMLInputElement;
    fireEvent.blur(field);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

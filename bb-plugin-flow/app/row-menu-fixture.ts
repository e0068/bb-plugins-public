// Меню «⋯» строки этапа в тестах: Radix открывает его нажатием указателя, а пункты ищутся в открытом меню.
import { fireEvent, screen, within } from "@testing-library/react";

export const openRowMenu = async (row: HTMLElement) => {
  const trigger = within(row).getByRole("button", { name: /^Действия с этапом/ });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  return within(await screen.findByRole("menu"));
};

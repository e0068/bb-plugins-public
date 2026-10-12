// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AddRow } from "./add-row";
import { LocaleContext } from "./locale-context";

afterEach(cleanup);

const row = (value: string) =>
  render(
    <LocaleContext.Provider value="ru">
      <AddRow label="Дополнить" value={value} onText={() => {}} disabled={false} voiceId={null} />
    </LocaleContext.Provider>,
  );

describe("метки картинок в строке ввода брифа", () => {
  it("метка «[Изображение N]» нарисована тегом, а поле по-прежнему держит весь текст", () => {
    const { container, getByRole } = row("[Изображение 1] Заодно поменяй шрифт. [Изображение 2]");
    expect([...container.querySelectorAll("[data-image-tag]")].map((tag) => tag.textContent)).toEqual(["[Изображение 1]", "[Изображение 2]"]);
    expect((getByRole("textbox", { name: "Дополнить" }) as HTMLTextAreaElement).value).toBe("[Изображение 1] Заодно поменяй шрифт. [Изображение 2]");
  });

  it("текст без меток — одно поле, без копии под ним", () => {
    const { container } = row("просто текст");
    expect(container.querySelector("[data-marked-copy]")).toBeNull();
  });
});

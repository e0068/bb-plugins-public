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
  it("метка «[картинка N]» нарисована тегом, а поле по-прежнему держит весь текст", () => {
    const { container, getByRole } = row("[картинка 1] Заодно поменяй шрифт. [картинка 2]");
    expect([...container.querySelectorAll("[data-image-tag]")].map((tag) => tag.textContent)).toEqual(["[картинка 1]", "[картинка 2]"]);
    expect((getByRole("textbox", { name: "Дополнить" }) as HTMLTextAreaElement).value).toBe("[картинка 1] Заодно поменяй шрифт. [картинка 2]");
  });

  it("текст без меток — одно поле, без копии под ним", () => {
    const { container } = row("просто текст");
    expect(container.querySelector("[data-marked-copy]")).toBeNull();
  });
});

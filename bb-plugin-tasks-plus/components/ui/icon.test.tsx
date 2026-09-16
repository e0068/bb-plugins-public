// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Icon, ICON_NAMES, type IconName } from "./icon.js";

afterEach(cleanup);

/**
 * Имя иконки приходит не только из кода: виды берут его из карт, ключом в
 * которых служит поле задачи (`TYPE_ICONS[task.type]`). Поле, которого карта
 * не знает, давало `undefined`, а `HugeiconsIcon` разворачивает иконку через
 * spread — и одна неизвестная иконка роняла всё дерево до пустого экрана.
 * Отсюда обещание: глиф — украшение, и его отсутствие не стоит экрана.
 */
describe("Icon", () => {
  it("рисует глиф для известного имени", () => {
    const { container } = render(<Icon name={ICON_NAMES[0]!} />);
    expect(container.querySelector(`[data-icon="${ICON_NAMES[0]}"]`)).not.toBeNull();
  });

  it("не роняет рендер на неизвестном имени", () => {
    expect(() => render(<Icon name={"НетТакойИконки" as IconName} />)).not.toThrow();
  });

  it("не роняет рендер, когда имени нет вовсе", () => {
    expect(() => render(<Icon name={undefined as unknown as IconName} />)).not.toThrow();
  });

  it("помечает пропущенный глиф, чтобы его было видно в отладке", () => {
    const { container } = render(<Icon name={"НетТакойИконки" as IconName} />);
    expect(container.querySelector("[data-icon-missing]")).not.toBeNull();
  });
});

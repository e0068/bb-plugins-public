// @vitest-environment node
import { describe, expect, it } from "vitest";

import { en } from "./en";
import { ru } from "./ru";

describe("подписи итогов прогона согласуют число со словом", () => {
  it("русские: один, два-четыре, пять и больше, одиннадцать-четырнадцать", () => {
    expect(ru.summary.agents(1, 0)).toBe("1 агент · 0 workflow");
    expect(ru.summary.agents(2, 1)).toBe("2 агента · 1 workflow");
    expect(ru.summary.agents(5, 0)).toBe("5 агентов · 0 workflow");
    expect(ru.summary.agents(11, 0)).toBe("11 агентов · 0 workflow");
    expect(ru.summary.agents(21, 0)).toBe("21 агент · 0 workflow");
    expect(ru.summary.agents(22, 0)).toBe("22 агента · 0 workflow");
    expect(ru.summary.stages(1)).toBe("1 этап");
    expect(ru.summary.stages(3)).toBe("3 этапа");
    expect(ru.summary.stages(9)).toBe("9 этапов");
    expect(ru.summary.stages(14)).toBe("14 этапов");
  });

  it("счётчик шагов склоняется так же, как раньше", () => {
    expect([1, 2, 5, 11, 21].map(ru.settings.stepCount)).toEqual(["1 шаг", "2 шага", "5 шагов", "11 шагов", "21 шаг"]);
  });

  it("английские: единственное число только у единицы", () => {
    expect(en.summary.agents(1, 1)).toBe("1 agent · 1 workflow");
    expect(en.summary.agents(2, 0)).toBe("2 agents · 0 workflows");
    expect(en.summary.stages(1)).toBe("1 stage");
    expect(en.summary.stages(9)).toBe("9 stages");
  });
});

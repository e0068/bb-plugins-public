// Этап под указателем при перетаскивании строки: строки одного этапа — связка этапа-flow — одна рамка.
import { describe, expect, it } from "vitest";

import { hoverAt } from "./row-hover";

const row = (id: string, top: number) => ({ id, top, bottom: top + 40 });

describe("этап под указателем", () => {
  it("строк нет — этапа нет", () => {
    expect(hoverAt([], 10)).toBeNull();
  });

  it("выше таблицы — верх первого этапа, ниже — низ последнего", () => {
    const rows = [row("a", 100), row("b", 140)];
    expect(hoverAt(rows, 50)).toEqual({ target: "a", zone: 1 });
    expect(hoverAt(rows, 500)).toEqual({ target: "b", zone: 4 });
  });

  it("четверть считается по высоте строки этапа", () => {
    const rows = [row("a", 100)];
    expect(hoverAt(rows, 105)).toEqual({ target: "a", zone: 1 });
    expect(hoverAt(rows, 125)).toEqual({ target: "a", zone: 3 });
    expect(hoverAt(rows, 139)).toEqual({ target: "a", zone: 4 });
  });

  it("нижняя четверть последней строки связки — низ этапа-flow, а не середина", () => {
    const rows = [row("task", 0), row("nested", 40), row("nested", 80), row("nested", 120), row("demo", 160)];
    // Связка 40…160: нижняя четверть — от 130.
    expect(hoverAt(rows, 150)).toEqual({ target: "nested", zone: 4 });
    expect(hoverAt(rows, 45)).toEqual({ target: "nested", zone: 1 });
    expect(hoverAt(rows, 100)).toEqual({ target: "nested", zone: 3 });
  });

  it("одноимённые строки не подряд — разные рамки", () => {
    const rows = [row("a", 0), row("b", 40), row("a", 80)];
    expect(hoverAt(rows, 85)).toEqual({ target: "a", zone: 1 });
  });
});

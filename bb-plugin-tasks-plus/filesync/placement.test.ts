import { describe, expect, it } from "vitest";
import { nextPlacement, placementSegments, validatePlacementName } from "./placement.js";

describe("placementSegments", () => {
  it("без исполнителя папок над статусом нет", () => {
    expect(placementSegments({ assignee: null, epic: null })).toEqual([]);
  });

  it("исполнитель — одна папка, исполнитель с эпиком — две", () => {
    expect(placementSegments({ assignee: "Claude", epic: null })).toEqual(["Claude"]);
    expect(placementSegments({ assignee: "Claude", epic: "Tasks+" })).toEqual(["Claude", "Tasks+"]);
  });
});

describe("validatePlacementName", () => {
  it("обрезает пробелы по краям и оставляет имя как есть", () => {
    expect(validatePlacementName("  Tasks+ ", "Epic")).toBe("Tasks+");
  });

  it.each(["", "   ", "a/b", "a\\b", ".", "..", ".hidden"])("отвергает имя %j, которое не может быть папкой", (raw) => {
    expect(() => validatePlacementName(raw, "Assignee")).toThrow(/Assignee/);
  });

  it.each(["done", "In progress", "to-do"])("отвергает имя статуса %j — папку прочли бы как статус", (raw) => {
    expect(() => validatePlacementName(raw, "Epic")).toThrow(/status/);
  });
});

describe("nextPlacement", () => {
  const current = { assignee: "Claude", epic: "Tasks+" };

  it("незаданные поля не трогают текущее место", () => {
    expect(nextPlacement(current, {})).toEqual(current);
  });

  it("смена исполнителя сохраняет эпик", () => {
    expect(nextPlacement(current, { assignee: "Sergey" })).toEqual({ assignee: "Sergey", epic: "Tasks+" });
  });

  it("снятие исполнителя снимает и эпик", () => {
    expect(nextPlacement(current, { assignee: null })).toEqual({ assignee: null, epic: null });
  });

  it("эпик без исполнителя отвергается", () => {
    expect(() => nextPlacement({ assignee: null, epic: null }, { epic: "Tasks+" })).toThrow(/assignee/);
    expect(() => nextPlacement(current, { assignee: null, epic: "Tasks+" })).toThrow(/assignee/);
  });

  it("новые имена проходят проверку", () => {
    expect(() => nextPlacement(current, { epic: "a/b" })).toThrow(/Epic/);
  });
});

describe("nextPlacement: текущее место с диска", () => {
  it("правка без исполнителя и эпика оставляет имена папок как есть, даже нестандартные", () => {
    const odd = { assignee: "Alice ", epic: "a\\b" };
    expect(nextPlacement(odd, {})).toEqual(odd);
    expect(nextPlacement(odd, { assignee: "Bob" })).toEqual({ assignee: "Bob", epic: "a\\b" });
  });
});

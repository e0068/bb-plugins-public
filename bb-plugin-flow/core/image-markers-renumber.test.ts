// @vitest-environment node
import { describe, expect, it } from "vitest";

import { freshNumbers, renumberMarkers } from "./image-markers";

const image = (n: number) => `[Изображение ${n}]`;
const file = (n: number) => `[файл ${n}]`;

describe("номера картинок виджета, переезжающие на свободные", () => {
  it("свободный номер остаётся на месте, занятый уходит на ближайший свободный, и выданное становится занятым", () => {
    const taken = new Set([1, 2]);
    expect(freshNumbers(taken, [1, 3])).toEqual(new Map([[1, 3], [3, 4]]));
    expect(taken).toEqual(new Set([1, 2, 3, 4]));
    expect(freshNumbers(new Set([1]), [2])).toEqual(new Map([[2, 2]]));
  });

  it("два виджета с одной и той же «картинкой 1» получают разные номера", () => {
    const taken = new Set<number>();
    const first = freshNumbers(taken, [1]);
    const second = freshNumbers(taken, [1]);
    expect(first.get(1)).toBe(1);
    expect(second.get(1)).toBe(2);
  });

  it("нечего переносить — карта пустая, занятые не меняются", () => {
    const taken = new Set([5]);
    expect(freshNumbers(taken, [])).toEqual(new Map());
    expect(taken).toEqual(new Set([5]));
  });
});

describe("перенумерация меток в тексте", () => {
  it("метки меняют номера по карте, вид метки и остальной текст остаются", () => {
    const text = "Шапка [Изображение 1], рядом [файл 2] и снова [Изображение 1]";
    expect(renumberMarkers(text, [image, file], new Map([[1, 4], [2, 5]]))).toBe("Шапка [Изображение 4], рядом [файл 5] и снова [Изображение 4]");
  });

  it("метка, которой нет в карте, остаётся как была; обмен номеров не идёт по кругу", () => {
    expect(renumberMarkers("[Изображение 3]", [image], new Map([[1, 2]]))).toBe("[Изображение 3]");
    expect(renumberMarkers("[Изображение 1] [Изображение 2]", [image], new Map([[1, 2], [2, 1]]))).toBe("[Изображение 2] [Изображение 1]");
  });

  it("текст без меток не меняется", () => {
    expect(renumberMarkers("просто слова", [image], new Map([[1, 2]]))).toBe("просто слова");
  });
});

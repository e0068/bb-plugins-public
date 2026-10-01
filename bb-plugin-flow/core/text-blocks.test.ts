import { describe, expect, it } from "vitest";
import { textBlocks } from "./text-blocks";

describe("текст брифа режется на абзацы и пункты списка", () => {
  it("пустой текст — ни одного блока", () => {
    expect(textBlocks("")).toEqual([]);
  });

  it("строка без маркеров — один абзац, как была", () => {
    expect(textBlocks("Просто текст со [ссылкой](a.ts).")).toEqual([{ kind: "paragraph", text: "Просто текст со [ссылкой](a.ts)." }]);
  });

  it("строки подряд без маркеров — один абзац, пустая строка их разделяет", () => {
    expect(textBlocks("первая\nвторая\n\nтретья")).toEqual([
      { kind: "paragraph", text: "первая вторая" },
      { kind: "paragraph", text: "третья" },
    ]);
  });

  it("три уровня по отступу в два пробела — три вложенных списка", () => {
    expect(textBlocks("- верх\n  - средний\n    - низ\n- второй верх")).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [
          {
            text: "верх",
            children: [{ kind: "list", ordered: false, items: [{ text: "средний", children: [{ kind: "list", ordered: false, items: [{ text: "низ", children: [] }] }] }] }],
          },
          { text: "второй верх", children: [] },
        ],
      },
    ]);
  });

  it("нумерованный и маркированный уровни различаются", () => {
    expect(textBlocks("1. шаг\n   * деталь\n2. шаг два")).toEqual([
      {
        kind: "list",
        ordered: true,
        items: [
          { text: "шаг", children: [{ kind: "list", ordered: false, items: [{ text: "деталь", children: [] }] }] },
          { text: "шаг два", children: [] },
        ],
      },
    ]);
  });

  it("абзац перед списком остаётся абзацем, а список идёт следом", () => {
    expect(textBlocks("Вот что я понял:\n- база\n- этапы")).toEqual([
      { kind: "paragraph", text: "Вот что я понял:" },
      { kind: "list", ordered: false, items: [{ text: "база", children: [] }, { text: "этапы", children: [] }] },
    ]);
  });

  it("строка с отступом без маркера продолжает текст пункта", () => {
    expect(textBlocks("- длинный пункт\n  с продолжением")).toEqual([{ kind: "list", ordered: false, items: [{ text: "длинный пункт с продолжением", children: [] }] }]);
  });

  it("таб считается двумя пробелами отступа", () => {
    expect(textBlocks("- верх\n\t- низ")).toEqual([
      { kind: "list", ordered: false, items: [{ text: "верх", children: [{ kind: "list", ordered: false, items: [{ text: "низ", children: [] }] }] }] },
    ]);
  });

  it("пункт глубже, чем на уровень ниже родителя, встаёт ровно на уровень ниже", () => {
    expect(textBlocks("- верх\n      - сразу глубоко")).toEqual([
      { kind: "list", ordered: false, items: [{ text: "верх", children: [{ kind: "list", ordered: false, items: [{ text: "сразу глубоко", children: [] }] }] }] },
    ]);
  });
});

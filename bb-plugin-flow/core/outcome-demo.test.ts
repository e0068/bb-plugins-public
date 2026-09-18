// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { demoVerdict, paragraphs } from "./outcome";

describe("исход Демонстрации", () => {
  it("«Продолжить», «Учесть и продолжить», «На доработку» и неотвеченный итог", () => {
    expect(demoVerdict({ outcome: { accepted: true } })).toBe("continue");
    expect(demoVerdict({ outcome: { accepted: true, note: "  " } })).toBe("continue");
    expect(demoVerdict({ outcome: { accepted: true, note: "учти подпись" } })).toBe("comment");
    expect(demoVerdict({ outcome: { accepted: false, note: "переделай" } })).toBe("rework");
    expect(demoVerdict({ outcome: { accepted: false } })).toBeNull();
    expect(demoVerdict({})).toBeNull();
  });
});

describe("абзацы текста Демонстрации", () => {
  it("делятся пустой строкой, пустые отбрасываются", () => {
    expect(paragraphs("Первый.\n\nВторой\nс переносом.\n\n\n  \n")).toEqual(["Первый.", "Второй\nс переносом."]);
    expect(paragraphs("")).toEqual([]);
  });

  it("склейка абзацев через пустую строку возвращает те же абзацы", () => {
    const para = fc.stringMatching(/^[a-zа-я][a-zа-я .]{0,20}[a-zа-я.]$/);
    fc.assert(
      fc.property(fc.array(para, { maxLength: 6 }), (list) => {
        expect(paragraphs(list.join("\n\n"))).toEqual(list);
      }),
    );
  });
});

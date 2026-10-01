import { describe, expect, it } from "vitest";

import { stepFailure } from "./step-outcomes";

describe("провал шага из исключения", () => {
  it("конфликт слияния приходит списком файлов рядом с текстом", () => {
    const conflict = Object.assign(new Error("code.ts — conflicts with origin/main."), { files: ["code.ts", "docs/x.md"] });
    expect(stepFailure(conflict)).toEqual({ ok: false, error: "code.ts — conflicts with origin/main.", conflicts: ["code.ts", "docs/x.md"] });
  });

  it("прочее исключение — только текст, без списка", () => {
    expect(stepFailure(new Error("no environment"))).toEqual({ ok: false, error: "no environment" });
    expect(stepFailure("boom")).toEqual({ ok: false, error: "boom" });
  });

  it("поле files не из строк — не список конфликтов", () => {
    expect(stepFailure(Object.assign(new Error("x"), { files: [1, 2] }))).toEqual({ ok: false, error: "x" });
  });
});

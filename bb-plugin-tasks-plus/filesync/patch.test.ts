import { describe, expect, it } from "vitest";
import { applyPatch } from "./patch.js";

describe("applyPatch", () => {
  const current = { name: "Keep", color: "red", link: "proj_x" as string | null };

  it("undefined в патче оставляет поле как было", () => {
    expect(applyPatch(current, { name: undefined, color: "green" })).toEqual({
      name: "Keep", color: "green", link: "proj_x",
    });
  });

  it("null — настоящее значение и очищает поле", () => {
    expect(applyPatch(current, { link: null }).link).toBeNull();
  });

  it("не мутирует исходную запись", () => {
    applyPatch(current, { color: "blue" });
    expect(current.color).toBe("red");
  });
});

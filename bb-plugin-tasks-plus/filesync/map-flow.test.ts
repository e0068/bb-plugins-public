import { describe, expect, it } from "vitest";
import { mapFlow, mapFrontmatter } from "./map.js";

describe("mapFlow — блок flow из шапки файла задачи", () => {
  it("объект с id и названием — flow задачи", () => {
    expect(mapFlow({ id: "flow-code", name: "Code" })).toEqual({ id: "flow-code", name: "Code" });
  });

  it("нет поля, строка вместо объекта, пустой id или название — flow нет", () => {
    for (const value of [undefined, null, "flow-code", { id: "", name: "Code" }, { id: "flow-code", name: "" }, { id: 1, name: "Code" }, { id: "flow-code" }]) {
      expect(mapFlow(value)).toBeNull();
    }
  });

  it("задача из шапки несёт flow, а строку checks больше не читает", () => {
    const mapped = mapFrontmatter({ title: "T", checks: ["test"], flow: { id: "flow-code", name: "Code" } }, "todo", "t");
    expect(mapped.flow).toEqual({ id: "flow-code", name: "Code" });
    expect(mapped).not.toHaveProperty("checks");
  });
});

// @vitest-environment node
// Страница Flow по адресу окна: панель тредов не получает адрес свойствами, а подсветка выбранного flow идёт за ним.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { flowRoute, flowsSubPathOf } from "./panel-path";

describe("страница Flow по адресу окна", () => {
  it("корень страницы — пустой адрес панели, с косой чертой на конце тоже", () => {
    expect(flowsSubPathOf("/plugins/flow/flows")).toBe("");
    expect(flowsSubPathOf("/plugins/flow/flows/")).toBe("");
  });

  it("id flow из адреса страницы возвращается тем же, каким его записал flowRoute", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (id) => {
        expect(flowsSubPathOf(flowRoute(id))).toBe(id);
      }),
    );
  });

  it("история прогонов и вложенный путь остаются адресом панели", () => {
    expect(flowsSubPathOf("/plugins/flow/flows/history")).toBe("history");
    expect(flowsSubPathOf("/plugins/flow/flows/a/b")).toBe("a/b");
  });

  it("чужие страницы и похожие на страницу Flow адреса — не страница Flow", () => {
    expect(flowsSubPathOf("/threads/thr_1")).toBeNull();
    expect(flowsSubPathOf("/plugins/tasks/flows/x")).toBeNull();
    expect(flowsSubPathOf("/plugins/flow/flowsx")).toBeNull();
    expect(flowsSubPathOf("/plugins/flow/settings")).toBeNull();
    expect(flowsSubPathOf("/projects/p1/threads/thr_1")).toBeNull();
  });

  it("адрес с битым процентным кодированием не роняет разбор", () => {
    expect(flowsSubPathOf("/plugins/flow/flows/%E0%A4%A")).toBe("%E0%A4%A");
  });
});

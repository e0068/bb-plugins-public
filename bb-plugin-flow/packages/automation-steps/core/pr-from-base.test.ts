// Тред, работающий прямо в базовой ветке, PR открыть не может: шаг записал бы коммит в саму базу на GitHub.
import { describe, expect, it } from "vitest";

import { prFromBaseRefusal } from "./visibility";

describe("prFromBaseRefusal", () => {
  it("ветка треда — сама база: отказ называет ветку и что делать", () => {
    expect(prFromBaseRefusal("main", "main")).toBe(
      "The thread works on main itself — there is no branch to open a PR from. Move the work to its own branch and run the step again.",
    );
  });

  it("своя ветка треда — отказа нет", () => {
    expect(prFromBaseRefusal("bb/flow-thr_x", "main")).toBeNull();
  });
});

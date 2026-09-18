import { describe, expect, it } from "vitest";

import { en } from "./en";
import { ru } from "./ru";

describe("названия шагов git в Flow", () => {
  it.each([en, ru])("короткие git-названия со стрелкой «куда ← откуда» на обоих языках", (messages) => {
    expect(messages.steps["git.pull-main"]).toBe("Pull Main ← Origin");
    expect(messages.steps["git.fast-forward"]).toBe("FF Branch ← Main");
  });

  it.each([en, ru])("у трёх разрядов бампа и обновления плагинов есть подпись на обоих языках", (messages) => {
    expect(messages.steps["files.bump-major"]).toBe("Bump major");
    expect(messages.steps["files.bump-minor"]).toBe("Bump minor");
    expect(messages.steps["files.bump-patch"]).toBe("Bump patch");
    expect(messages.steps["bb.reinstall"].length).toBeGreaterThan(0);
  });
});

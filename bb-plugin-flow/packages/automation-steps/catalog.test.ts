import { describe, expect, it } from "vitest";

import { STEP_IDS, STEP_LABELS } from "./catalog";

describe("названия шагов git", () => {
  it("короткие git-названия со стрелкой «куда ← откуда», одинаковые на обоих языках", () => {
    expect(STEP_LABELS["git.pull-main"]).toEqual({ en: "Pull Main ← Origin", ru: "Pull Main ← Origin" });
    expect(STEP_LABELS["git.fast-forward"]).toEqual({ en: "FF Branch ← Main", ru: "FF Branch ← Main" });
  });
});

describe("каталог шагов", () => {
  it("у каждого шага есть подпись на обоих языках", () => {
    for (const id of STEP_IDS) {
      expect(STEP_LABELS[id].en.length).toBeGreaterThan(0);
      expect(STEP_LABELS[id].ru.length).toBeGreaterThan(0);
    }
    expect(Object.keys(STEP_LABELS)).toHaveLength(STEP_IDS.length);
  });

  it("бамп стоит между открытием PR и мёрджем, обновление плагинов — после мёрджа", () => {
    const at = (id: string) => STEP_IDS.indexOf(id as (typeof STEP_IDS)[number]);
    for (const level of ["files.bump-major", "files.bump-minor", "files.bump-patch"]) {
      expect(at(level)).toBeGreaterThan(at("git.create-pr"));
      expect(at(level)).toBeLessThan(at("git.merge"));
    }
    expect(at("bb.reinstall")).toBeGreaterThan(at("git.merge"));
  });
});

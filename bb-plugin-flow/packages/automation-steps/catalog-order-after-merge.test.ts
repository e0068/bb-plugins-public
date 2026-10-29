import { describe, expect, it } from "vitest";

import { STEP_IDS, type StepId } from "./catalog";

const at = (id: StepId) => STEP_IDS.indexOf(id);

describe("порядок шагов по умолчанию", () => {
  it("«Факт → задача» и «Задача → done» стоят после «Pull Main ← Origin»: «Задача → done» ждёт код треда в main", () => {
    for (const step of ["bb.tasks-fact", "bb.tasks-done"] as const) {
      expect(at(step)).toBeGreaterThan(at("git.merge"));
      expect(at(step)).toBeGreaterThan(at("git.pull-main"));
    }
  });
});

// @vitest-environment node
// Подложка строки полосы прогона: идущий этап — подсветка текущего, этап, который ставит прогон на паузу, — своя подложка.
import { describe, expect, it } from "vitest";

import { STAGE_KINDS } from "../lib/stage-constants";
import type { ProgressStage } from "../shared/contract";
import { rowTone } from "./progress";

const STATES = ["done", "now", "todo", "skip", "fail"] as const;
const tone = (kind: ProgressStage["kind"], state: ProgressStage["state"]) => rowTone({ kind, state });

describe("rowTone", () => {
  it("идущий и упавший этап любого вида — подсветка текущего", () => {
    for (const kind of STAGE_KINDS) for (const state of ["now", "fail"] as const) expect(tone(kind, state)).toBe("current");
  });

  it("Утверждение и кнопочный этап впереди или пройденные — подложка паузы", () => {
    for (const kind of ["approve", "action"] as const) for (const state of ["done", "todo"] as const) expect(tone(kind, state)).toBe("pause");
  });

  it("вычеркнутый этап паузы подложки не получает", () => {
    expect(tone("approve", "skip")).toBeNull();
    expect(tone("action", "skip")).toBeNull();
  });

  it("остальные виды, Демонстрация тоже, вне текущего — без подложки", () => {
    for (const kind of STAGE_KINDS.filter((each) => each !== "approve" && each !== "action"))
      for (const state of STATES.filter((each) => each !== "now" && each !== "fail")) expect(tone(kind, state)).toBeNull();
  });
});

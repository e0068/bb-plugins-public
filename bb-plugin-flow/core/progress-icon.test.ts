// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { WorkStage } from "../shared/contract";
import { EMPTY_PROGRESS, progressView } from "./progress";

const stage = (id: string, icon?: string): WorkStage => ({ id, kind: "skill", skill: id, name: id, executors: [], ...(icon === undefined ? {} : { icon }) });

describe("иконка этапа в полосе прогресса", () => {
  it("выбранная владельцем иконка едет в строку этапа, у этапа без неё поля нет", () => {
    const view = progressView(EMPTY_PROGRESS, [stage("spec", "Rocket"), stage("plan")]);
    expect(view.stages.map((s) => s.icon ?? null)).toEqual(["Rocket", null]);
  });
});

// @vitest-environment node
// Владелец снимает галкой любой этап, который держит прогон: и взятый, но не тронутый позади достигнутого, и предложенный агентом к снятию.
import { describe, expect, it } from "vitest";

import type { FlowProgress } from "../shared/contract";
import { isAhead, setStageInRun, toggleStageInRun } from "./progress";
import { stage } from "./stages-fixtures";

const AT = "2026-10-13T10:00:00.000Z";
const STAGES = [stage("plan"), stage("code"), stage("review")];
const run = (stages: FlowProgress["stages"], waiting: string[] = []): FlowProgress => ({ stages, waiting });

describe("этап позади достигнутого, которого никто не трогал", () => {
  const behind = run({ code: { startedAt: AT } });

  it("этап без записи можно снять галкой: он держит прогон, и других выходов у владельца нет", () => {
    expect(isAhead(behind, STAGES, "plan")).toBe(true);
    expect(toggleStageInRun(behind, STAGES, "plan", false).stages.plan?.skipped).toBe(true);
  });

  it("взятый владельцем и нетронутый этап позади тоже снимается", () => {
    expect(isAhead(run({ plan: { skipped: false }, code: { startedAt: AT } }), STAGES, "plan")).toBe(true);
  });

  it("этап, убранный брифом, позади идущего не возвращается: агент его уже миновал", () => {
    expect(isAhead(run({ plan: { skipped: true }, code: { startedAt: AT } }), STAGES, "plan")).toBe(false);
  });

  it("тронутый этап позади не меняется", () => {
    expect(isAhead(run({ plan: { startedAt: AT, finishedAt: AT }, code: { startedAt: AT } }), STAGES, "plan")).toBe(false);
  });
});

describe("галка у этапа, предложенного агентом к снятию", () => {
  const proposed = run({ code: { skipped: true, proposed: true } });

  it("снятый галкой этап снят сразу: метки ожидания утверждения нет", () => {
    const track = setStageInRun(proposed, "code", false).stages.code;
    expect(track?.skipped).toBe(true);
    expect(track?.proposed).toBeUndefined();
  });

  it("возвращённый галкой этап в прогоне, и метки нет", () => {
    const track = setStageInRun(proposed, "code", true).stages.code;
    expect(track?.skipped).toBe(false);
    expect(track?.proposed).toBeUndefined();
  });
});

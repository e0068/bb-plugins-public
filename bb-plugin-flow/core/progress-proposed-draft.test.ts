// @vitest-environment node
// Выбор этапов, который прогон не держит, копит ответ владельца до Утверждения. Этап, который агент не рекомендовал,
// до этого Утверждения остаётся в прогоне и держит следующие, а само Утверждение им не запирается — оно обязано его назвать.
import { describe, expect, it } from "vitest";

import type { DecisionBrief, FlowProgress, WorkStage } from "../shared/contract";
import { approvalIssues } from "./approval-guard";
import { unfinishedBefore } from "./automation-run";
import { EMPTY_PROGRESS, onBrief } from "./progress";
import { report, STAGES, stagedBrief } from "./stages-fixtures";

const AT = "2026-10-26T10:00:00.000Z";

const FLOW: WorkStage[] = [...STAGES, { id: "approve", kind: "approve", skill: "", name: "Approval", executors: [] }];

const selection: DecisionBrief = stagedBrief([report("task", { recommended: true }), report("spec"), report("plan", { recommended: true })], {
  stages: { list: FLOW, minButtonWidth: 170 },
  settle: "approval",
});

const sent = (): FlowProgress => onBrief(EMPTY_PROGRESS, selection, AT);

describe("выбор этапов, отправленный черновиком до Утверждения", () => {
  it("этап, который агент не рекомендовал, помечен предложенным и из прогона не снят", () => {
    const track = sent().stages.spec;
    expect(track?.proposed).toBe(true);
    expect(track?.skipped).not.toBe(true);
  });

  it("рекомендованный этап предложенным не помечается", () => {
    expect(sent().stages.task?.proposed).toBeUndefined();
  });

  it("предложенный этап держит следующий этап прогона", () => {
    expect(unfinishedBefore(FLOW, { ...sent(), stages: { ...sent().stages, task: { finishedAt: AT } } }, "plan")?.id).toBe("spec");
  });

  it("Утверждение предложенным этапом не запирается", () => {
    const progress = { ...sent(), stages: { ...sent().stages, task: { finishedAt: AT }, plan: { finishedAt: AT } } };
    expect(unfinishedBefore(FLOW, progress, "approve", false)).toBeNull();
  });

  it("Утверждение, которое не называет предложенный этап, получает отказ", () => {
    expect(approvalIssues(FLOW, sent(), "approve", false, "Готово: задача и план")).toEqual([expect.stringContaining('spec "Спецификация"')]);
  });

  it("Утверждение, которое называет предложенный этап, проходит", () => {
    expect(approvalIssues(FLOW, sent(), "approve", false, "Спецификация снята: задача мелкая")).toEqual([]);
  });
});

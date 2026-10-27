// @vitest-environment node
// BBPL-969: этап, который остановил владелец, агенту — «остановил владелец, продолжает только он», а не «упало, повтори сам».
import { describe, expect, it } from "vitest";

import type { FlowProgress, WorkStage } from "../shared/contract";
import { retriedReply, retryVerdict } from "./agent-retry";
import { STOPPED_ERROR, builtinAutomationStage, onRunStart, onRunStopped, onStepFailed, stepsOf } from "./automation-run";
import { afterMark, markReply, stopFailure, waitedReply } from "./mark-report";
import { EMPTY_PROGRESS } from "./progress";
import { stage } from "./stages-fixtures";

const T0 = "2026-10-27T10:00:00.000Z";

const ship: WorkStage = { ...builtinAutomationStage([]), id: "ship", name: "Ship", automation: { source: "flow", steps: ["git.commit", "git.create-pr"] } };
const review = stage("review");
const STAGES = [review, ship];

const reviewed: FlowProgress = { stages: { review: { startedAt: T0, finishedAt: T0 } }, waiting: [] };
const running = onRunStart(reviewed, ship.id, stepsOf(ship), T0);
const stopped = onRunStopped(running, ship.id, STOPPED_ERROR);
const failed = onStepFailed(running, ship.id, "gh: rate limited", T0);

describe("агент не повторяет то, что остановил владелец", () => {
  it("retry_automation на остановленном этапе — отказ: продолжает только владелец", () => {
    expect(retryVerdict(STAGES, stopped, "ship")).toMatchObject({ kind: "refused", reason: expect.stringContaining("stopped by the owner") });
  });

  it("упавший этап агент повторять по-прежнему может", () => {
    expect(retryVerdict(STAGES, failed, "ship")).toEqual({ kind: "retry", stage: ship });
  });
});

describe("ответы агенту об остановленном этапе", () => {
  const says = (text: string) => {
    expect(text).toContain("the owner stopped automation ship");
    expect(text).toContain("Continue");
    expect(text).not.toContain("failed");
    expect(text).not.toContain("retry_automation");
  };

  it("flow_stage за остановленным этапом: «остановил владелец», без совета повторить", () => {
    says(markReply("review", afterMark(STAGES, stopped, "review"), null));
  });

  it("flow_stage, дождавшийся автоматизации, которую остановили: то же", () => {
    says(waitedReply(ship, { kind: "quiet" }, stopFailure(STAGES, stopped)));
  });

  it("retry_automation, после которого владелец остановил цепочку: то же", () => {
    says(retriedReply(ship, { kind: "quiet" }, stopFailure(STAGES, stopped)));
  });

  it("у упавшего этапа ответ прежний: упало, можно повторить самому", () => {
    const text = waitedReply(ship, { kind: "quiet" }, stopFailure(STAGES, failed));
    expect(text).toContain("failed at step");
    expect(text).toContain("retry_automation");
  });
});

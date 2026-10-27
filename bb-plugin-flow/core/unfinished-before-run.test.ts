// @vitest-environment node
// Прогон держит работу: любой этап навыка прогона, который владелец не снял, обязателен — даже если его никто не трогал.
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowProgress, WorkStage } from "../shared/contract";
import { builtinAutomationStage, unfinishedBefore } from "./automation-run";
import { stage } from "./stages-fixtures";

const AT = "2026-10-13T10:00:00.000Z";
const STAGES = [stage("plan"), stage("code"), stage("review")];
const run = (stages: FlowProgress["stages"]): FlowProgress => ({ stages, waiting: [] });

describe("этап навыка прогона перед этапом держит его, пока не закрыт", () => {
  it("этап без записи прогресса в прогоне: держит следующие", () => {
    expect(unfinishedBefore(STAGES, run({}), "review")?.id).toBe("plan");
  });

  it("этап, который владелец взял, а агент не тронул, держит следующие", () => {
    expect(unfinishedBefore(STAGES, run({ plan: { skipped: false, finishedAt: AT }, code: { skipped: false } }), "review")?.id).toBe("code");
  });

  it("этап, снятый владельцем, не держит", () => {
    expect(unfinishedBefore(STAGES, run({ plan: { skipped: true }, code: { skipped: true } }), "review")).toBeNull();
  });

  it("закрытые этапы не держат", () => {
    expect(unfinishedBefore(STAGES, run({ plan: { finishedAt: AT }, code: { finishedAt: AT } }), "review")).toBeNull();
  });

  it("держит первый из нескольких открытых — в порядке flow", () => {
    expect(unfinishedBefore(STAGES, run({}), "review")?.id).toBe("plan");
    expect(unfinishedBefore(STAGES, run({ plan: { finishedAt: AT } }), "review")?.id).toBe("code");
  });

  it("этап после проверяемого не держит его", () => {
    expect(unfinishedBefore(STAGES, run({}), "plan")).toBeNull();
  });
});

describe("держит только то, что закрывает агент", () => {
  const automation: WorkStage = { ...builtinAutomationStage([]), id: "auto" };
  const flow = [builtinStage("questions", []), builtinStage("demo", []), automation, stage("code")];

  it("встроенные этапы и автоматизации не держат: их закрывают ответы владельца и Flow", () => {
    expect(unfinishedBefore(flow, run({}), "code")).toBeNull();
  });
});

describe("этап, снятый по предложению агента, снят только с утверждением", () => {
  it("предложенный к снятию этап держит следующие, пока владелец не утвердил", () => {
    expect(unfinishedBefore(STAGES, run({ plan: { finishedAt: AT }, code: { skipped: true, proposed: true } }), "review")?.id).toBe("code");
  });

  it("утверждённое снятие — этап снят и не держит", () => {
    expect(unfinishedBefore(STAGES, run({ plan: { finishedAt: AT }, code: { skipped: true } }), "review")).toBeNull();
  });
});

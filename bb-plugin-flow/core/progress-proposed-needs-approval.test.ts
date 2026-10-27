// @vitest-environment node
// Снятие по предложению агента ждёт утверждения, только когда после выбора этапов утверждение есть во flow:
// иначе метку снимать некому, и этап навсегда держал бы прогон.
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, WorkStage } from "../shared/contract";
import { EMPTY_PROGRESS, onAnswer } from "./progress";
import { report, STAGES, stagedBrief } from "./stages-fixtures";

const AT = "2026-10-13T10:00:00.000Z";
const approve: WorkStage = { id: "approve", kind: "approve", skill: "", name: "Approval", executors: [] };
const select: WorkStage = { id: "select", kind: "select", skill: "", name: "Stage selection", executors: [] };

const answer: DecisionAnswer = { briefId: "dec_stages", answers: [], stages: [{ id: "task", run: true, executor: "self" }, { id: "spec", run: false, executor: "self" }, { id: "plan", run: true, executor: "self" }] };
const reports = [report("task", { recommended: true }), report("spec"), report("plan", { recommended: true })];

const spec = (list: WorkStage[]) => onAnswer(EMPTY_PROGRESS, stagedBrief(reports, { stages: { list, minButtonWidth: 170 } }), answer, AT).stages.spec;

describe("предложенный к снятию этап и утверждение во flow", () => {
  it("утверждение стоит после выбора этапов — снятие ждёт утверждения", () => {
    expect(spec([select, ...STAGES, approve])).toMatchObject({ skipped: true, proposed: true });
  });

  it("утверждения во flow нет — снятие вступает сразу", () => {
    const track = spec([select, ...STAGES]);
    expect(track?.skipped).toBe(true);
    expect(track?.proposed).toBeUndefined();
  });

  it("утверждение стоит только до выбора этапов — оно снятия не утвердит, снятие вступает сразу", () => {
    expect(spec([approve, select, ...STAGES])?.proposed).toBeUndefined();
  });
});

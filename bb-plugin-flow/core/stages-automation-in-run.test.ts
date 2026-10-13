// @vitest-environment node
// Тред SHA-253: агент не отметил в брифе автоматизации, и прогон закрылся без коммита, PR и закрытия задач.
// Автоматизацию исполняет сам Flow, поэтому в прогон она идёт по умолчанию; снять её может только владелец.
import { describe, expect, it } from "vitest";

import { answeredStageChoice, initialStageChoice, stageItems } from "./stages";
import { report, stage, stagedBrief } from "./stages-fixtures";
import type { DecisionAnswer, WorkStage } from "../shared/contract";

const publish: WorkStage = { id: "flow-automation", kind: "skill", skill: "", name: "Commit, FF, PR", executors: [], automation: { source: "flow", steps: ["git.commit", "git.create-pr"] } };

const brief = stagedBrief([report("implement", { recommended: true, share: { percent: 100, risk: 0 } }), report("flow-automation", { recommended: false })], {
  stages: { list: [stage("implement"), publish], minButtonWidth: 170 },
});

const itemOf = (id: string) => stageItems(brief).find((i) => i.stage.id === id)!;

describe("автоматизация в выборе этапов", () => {
  it("стоит в прогоне, хотя агент её не отметил", () => {
    expect(initialStageChoice(brief, itemOf("flow-automation")).run).toBe(true);
  });

  it("снятая владельцем — вне прогона", () => {
    const answer: DecisionAnswer = { briefId: brief.id, answers: [], stages: [{ id: "flow-automation", run: false, executor: "self" }] };
    expect(answeredStageChoice(brief, answer, itemOf("flow-automation")).run).toBe(false);
  });

  it("пройденная автоматизация в прогон заново не встаёт", () => {
    const done = stagedBrief([report("flow-automation", { state: "done" })], { stages: { list: [publish], minButtonWidth: 170 } });
    expect(initialStageChoice(done, stageItems(done)[0]!).run).toBe(false);
  });
});

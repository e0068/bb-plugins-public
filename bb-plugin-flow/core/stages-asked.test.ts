// @vitest-environment node
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import { stageItems, stagePhase } from "./stages";
import { report, stage, stagedBrief } from "./stages-fixtures";

const LIST = [builtinStage("questions", []), builtinStage("criteria", ["questions"]), builtinStage("select", ["questions", "criteria"]), stage("task"), builtinStage("demo", [])];

const phases = (reports: Parameters<typeof stagedBrief>[0]) =>
  Object.fromEntries(stageItems(stagedBrief(reports, { stages: { list: LIST, minButtonWidth: 170 } })).map((item) => [item.stage.id, stagePhase(item)]));

describe("этапы, на которые бриф отвечает сам", () => {
  it("показанные брифом Вопросы, Критерии и Выбор этапов стоят в нём сделанными", () => {
    expect(phases([report("questions"), report("criteria", { recommended: true }), report("select", { recommended: true }), report("task", { recommended: true }), report("demo")])).toEqual({
      questions: "done",
      criteria: "done",
      select: "done",
      task: "todo",
      demo: "todo",
    });
  });

  it("встроенный этап после несделанного этапа навыка брифом ещё не пройден", () => {
    const list = [stage("task"), builtinStage("criteria", [])];
    const items = stageItems(stagedBrief([report("task"), report("criteria")], { stages: { list, minButtonWidth: 170 } }));
    expect(items.map(stagePhase)).toEqual(["todo", "todo"]);
  });
});

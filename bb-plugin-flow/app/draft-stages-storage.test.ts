// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { planner, report, stagedBrief } from "../core/stages-fixtures";
import { decodeDraft, encodeDraft } from "./draft-storage";
import { emptyDraft, pickStageExecutor, stageChoiceIn, toggleStageRun } from "./draft";
import { stageItems } from "../core/stages";

const brief = stagedBrief([report("task"), report("spec"), report("plan", { recommended: true })]);

describe("черновик этапов в хранилище окна", () => {
  it("выбор прогона и исполнителя по этапу переживает запись и чтение", () => {
    const plan = stageItems(brief)[2]!;
    const draft = pickStageExecutor(toggleStageRun(brief, emptyDraft(), plan), plan, planner.id);
    const read = decodeDraft(encodeDraft(draft))!;
    expect(stageChoiceIn(brief, read, plan)).toEqual({ run: false, executor: planner.id });
  });

  it("черновик без этапов читается с пустым выбором, чужая форма этапов — нет черновика", () => {
    const { stages: _stages, ...old } = emptyDraft();
    expect(decodeDraft(JSON.stringify(old))?.stages).toEqual({});
    expect(decodeDraft(JSON.stringify({ ...old, stages: [1, 2] }))).toBeNull();
  });
});

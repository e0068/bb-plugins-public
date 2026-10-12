// @vitest-environment node
// Галочка строки вложенного flow в брифе: ставит или снимает все его несделанные этапы, при выборе не всех — полувыбрана.
import { describe, expect, it } from "vitest";

import { report, stage, stagedBrief } from "../core/stages-fixtures";
import { stageItems } from "../core/stages";
import { emptyDraft, nestRun, toAnswer, toggleNestRun, toggleStageRun, type Draft } from "./draft";

const BRIEF = [{ id: "nested", name: "Brief" }];
// Во вложенном flow три этапа: вопросы пройдены, задача и переименование впереди; рядом — этап самого flow.
const brief = stagedBrief([report("nested.questions", { state: "done" }), report("nested.task", { recommended: true }), report("nested.rename", { recommended: true }), report("spec", { recommended: true })], {
  stages: { list: [stage("nested.questions", { nest: BRIEF }), stage("nested.task", { nest: BRIEF }), stage("nested.rename", { nest: BRIEF }), stage("spec")], minButtonWidth: 170 },
});
const item = (id: string) => stageItems(brief).find((i) => i.stage.id === id)!;
const runs = (draft: Draft) => Object.fromEntries((toAnswer(brief, draft).stages ?? []).filter((s) => s.id !== "nested.questions").map((s) => [s.id, s.run]));

describe("галочка вложенного flow в черновике брифа", () => {
  it("все несделанные этапы в прогоне — галочка стоит, щелчок снимает их все, этап вне flow не трогает", () => {
    expect(nestRun(brief, emptyDraft(), "nested")).toBe(true);
    const off = toggleNestRun(brief, emptyDraft(), "nested");
    expect(runs(off)).toEqual({ "nested.task": false, "nested.rename": false, spec: true });
    expect(nestRun(brief, off, "nested")).toBe(false);
  });

  it("выбраны не все — галочка полувыбрана, щелчок ставит все", () => {
    const some = toggleStageRun(brief, emptyDraft(), item("nested.rename"));
    expect(nestRun(brief, some, "nested")).toBe("mixed");
    expect(runs(toggleNestRun(brief, some, "nested"))).toEqual({ "nested.task": true, "nested.rename": true, spec: true });
  });

  it("пройденный этап flow на галочку не влияет и щелчком не меняется", () => {
    const off = toggleNestRun(brief, emptyDraft(), "nested");
    expect(off.stages["nested.questions"]).toBeUndefined();
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { Artifact, DecisionBrief } from "../shared/contract";
import { openQuestions } from "./answer-message";
import { requiredArtifacts } from "./required";
import { SETUP_ROW } from "./rows";

const artifacts: Artifact[] = [
  { id: "task", name: "Задача", state: "approved", recommended: false, link: { label: "SL-1", target: "t.md" } },
  { id: "prototype", name: "HTML-прототип", state: "ready", recommended: false, link: { label: "p.html", target: "p.html" } },
  { id: "spec", name: "Спецификация", state: "stale", recommended: true },
  { id: "plan", name: "План", state: "missing", recommended: false },
];

describe("обязательные документы", () => {
  it("«сделать» касается неактуального и отсутствующего, «утвердить» — готового и утверждённого", () => {
    expect(requiredArtifacts(artifacts, { make: ["task", "spec", "plan"], approve: ["prototype", "plan"] }).map((a) => a.id)).toEqual(["prototype", "spec", "plan"]);
  });

  it("бриф с обязательным документом без галочки не закрыт", () => {
    const brief: DecisionBrief = { id: "dec_1", threadId: "thr_1", title: "Бриф", createdAt: "2026-09-13T00:00:00.000Z", kind: "brief", revocable: true, required: { make: ["spec"], approve: [] }, setup: { artifacts }, questions: [] };
    const answer = (ids: string[]) => ({ briefId: brief.id, answers: [{ questionId: SETUP_ROW.artifacts, optionIds: ids }] });
    expect(openQuestions(brief, answer(["task"]))).toEqual([SETUP_ROW.artifacts]);
    expect(openQuestions(brief, answer(["task", "spec"]))).toEqual([]);
  });
});

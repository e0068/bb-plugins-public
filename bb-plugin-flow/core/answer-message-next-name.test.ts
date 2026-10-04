// @vitest-environment node
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief } from "../shared/contract";
import { answerMessageText } from "./answer-message";
import { stage } from "./stages-fixtures";

const brief = (next: string): DecisionBrief => ({
  id: "dec_demo",
  threadId: "thr_1",
  title: "Демонстрация",
  createdAt: "2026-10-03T17:00:00.000Z",
  kind: "brief",
  questions: [],
  outcome: { stage: "demo", final: false, next, done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] },
  stages: { list: [{ ...builtinStage("demo", []), name: "Демонстрация" }, stage("flow-automation-2", { name: "Merge, Site, Publish", automation: { source: "flow", steps: [] } })], minButtonWidth: 160 },
});

const nextLine = (b: DecisionBrief) => answerMessageText(b, { briefId: b.id, answers: [], outcome: { accepted: true } }, "ru").split("\n").find((l) => l.startsWith("Дальше")) ?? "";

describe("строка «Дальше — этап …» на Демонстрацию", () => {
  it("называет этап по имени из flow, когда агент указал его id", () => {
    expect(nextLine(brief("flow-automation-2"))).toBe("Дальше — этап «Merge, Site, Publish».");
  });

  it("оставляет как есть то, что не id этапа flow", () => {
    expect(nextLine(brief("Спецификация"))).toBe("Дальше — этап «Спецификация».");
  });
});

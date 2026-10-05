// @vitest-environment node
// Этап критериев зовётся Definition of Done везде: и новый, и сохранённый раньше под именем «Criteria».
import { describe, expect, it } from "vitest";

import { messages } from "../lib/messages";
import { builtinStage } from "../lib/stage-constants";
import { wakeText } from "./automation-run";
import { stageInstructions, stageLabel } from "./stages";

const saved = { id: "criteria", kind: "criteria" as const, skill: "", name: "Criteria", executors: [] };

describe("этап критериев — Definition of Done", () => {
  it("новый встроенный этап заводится под именем Definition of Done", () => {
    expect(builtinStage("criteria", []).name).toBe("Definition of Done");
  });

  it("сохранённый под прежним именем Criteria этап агент видит как Definition of Done", () => {
    expect(stageInstructions([saved])).toContain('1. criteria "Definition of Done"');
  });

  it("реплика агенту о следующем этапе называет сохранённый под прежним именем этап Definition of Done", () => {
    expect(wakeText("automation", [], saved)).toContain('Next stage: criteria "Definition of Done".');
  });

  it("сохранённый под прежним именем этап подписан строками интерфейса на обоих языках", () => {
    expect(stageLabel(saved, messages("ru").stages)).toBe(messages("ru").stages.criteria);
    expect(stageLabel(saved, messages("en").stages)).toBe(messages("en").stages.criteria);
  });

  it("этап, переименованный владельцем, сохраняет его имя", () => {
    expect(stageInstructions([{ ...saved, name: "Приёмка" }])).toContain('1. criteria "Приёмка"');
  });

  it("прежнее имя одного вида не делает этап другого вида безымянным", () => {
    expect(stageLabel({ ...saved, id: "demo", kind: "demo" }, messages("en").stages)).toBe("Criteria");
  });
});

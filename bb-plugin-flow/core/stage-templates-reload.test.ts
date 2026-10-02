// @vitest-environment node
import { describe, expect, it } from "vitest";

import { flowSettingsSchema, type WorkStage } from "../shared/contract";
import { isTemplateSaved, saveTemplate } from "./stage-templates";

const stage: WorkStage = { id: "spec", kind: "skill", skill: "spec", name: "Спека", executors: [{ id: "agent:x", kind: "agent", name: "x" }], icon: "Rocket" };

describe("шаблон этапа после перезагрузки страницы", () => {
  it("сохранённый этап с иконкой узнаётся и после того, как коллекция прошла разбор схемами", () => {
    const settings = flowSettingsSchema.parse({ flows: [{ id: "f", name: "F", stages: [stage] }], minButtonWidth: 170, stageTemplates: saveTemplate([], stage) });
    expect(isTemplateSaved(settings.stageTemplates ?? [], settings.flows[0]!.stages[0]!)).toBe(true);
  });
});

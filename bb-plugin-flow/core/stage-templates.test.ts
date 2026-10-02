// @vitest-environment node
import { describe, expect, it } from "vitest";

import { flowSettingsSchema, type StageTemplate, type WorkStage } from "../shared/contract";
import { isTemplateSaved, removeTemplate, saveTemplate, stageFromTemplate } from "./stage-templates";

const reviewer = { id: "agent:code-reviewer", kind: "agent" as const, name: "code-reviewer", model: "opus" };
const review: WorkStage = { id: "code-review", kind: "skill", skill: "code-review", name: "code-review", icon: "Search", executors: [reviewer], parent: "practice" };
const shipping: WorkStage = {
  id: "ship",
  kind: "skill",
  skill: "",
  name: "Ship",
  executors: [],
  automation: { source: "flow", steps: ["git.commit", "script:s1"], scripts: [{ id: "s1", name: "deploy.sh", content: "echo" }] },
};
let counter = 0;
const newId = () => `n${++counter}`;

describe("шаблон этапа — этап целиком без места в flow", () => {
  it("закладка кладёт этап в конец списка без id и под-этапности; повтор того же этапа список не меняет", () => {
    const once = saveTemplate([], review);
    expect(once).toEqual([{ kind: "skill", skill: "code-review", name: "code-review", icon: "Search", executors: [reviewer] }]);
    expect(saveTemplate(once, { ...review, id: "other", parent: "x" })).toBe(once);
  });

  it("сохранён ли этап, видно и у его копии в другом flow; другое название — другой шаблон", () => {
    const saved = saveTemplate([], review);
    expect(isTemplateSaved(saved, { ...review, id: "copy" })).toBe(true);
    expect(isTemplateSaved(saved, { ...review, name: "Ревью" })).toBe(false);
  });

  it("скрипты сравниваются именем и содержимым: копия со своими id скриптов — тот же шаблон", () => {
    const saved = saveTemplate([], shipping);
    const copy = stageFromTemplate(saved[0]!, "ship-2", newId);
    expect(isTemplateSaved(saved, copy)).toBe(true);
  });

  it("этап из шаблона совпадает с сохранённым, кроме нового id и новых id скриптов", () => {
    const [template] = saveTemplate([], shipping);
    const stage = stageFromTemplate(template!, "ship-2", newId);
    expect(stage.id).toBe("ship-2");
    expect(stage.parent).toBeUndefined();
    const scriptId = stage.automation !== undefined && "scripts" in stage.automation ? stage.automation.scripts?.[0]?.id : undefined;
    expect(scriptId).not.toBe("s1");
    expect(stage.automation).toEqual({ source: "flow", steps: ["git.commit", `script:${scriptId}`], scripts: [{ id: scriptId, name: "deploy.sh", content: "echo" }] });
    expect({ ...stage, id: undefined, automation: undefined }).toEqual({ ...template, id: undefined, automation: undefined });
  });

  it("крест убирает шаблон по месту, остальные на местах", () => {
    const two = saveTemplate(saveTemplate([], review), shipping);
    expect(removeTemplate(two, 0)).toEqual([two[1]]);
  });

  it("шаблоны и иконка этапа сохраняются в настройках Flow", () => {
    const templates: StageTemplate[] = [...saveTemplate([], review)];
    const parsed = flowSettingsSchema.parse({ flows: [{ id: "f", name: "F", stages: [{ ...review, parent: undefined }] }], minButtonWidth: 170, stageTemplates: templates });
    expect(parsed.stageTemplates).toEqual(templates);
    expect(parsed.flows[0]!.stages[0]!.icon).toBe("Search");
  });
});

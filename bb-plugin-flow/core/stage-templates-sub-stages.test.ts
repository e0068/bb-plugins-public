// @vitest-environment node
import { describe, expect, it } from "vitest";

import { flowSettingsSchema, type StageTemplate, type WorkStage } from "../shared/contract";
import { isTemplateSaved, removeTemplate, saveTemplate, stagesFromTemplate } from "./stage-templates";

const reviewer = { id: "agent:code-reviewer", kind: "agent" as const, name: "code-reviewer", model: "opus" };
const skill = (id: string, patch: Partial<WorkStage> = {}): WorkStage => ({ id, kind: "skill", skill: id, name: id, executors: [], ...patch });
const review = skill("code-review", { icon: "Search", executors: [reviewer] });
const shipping: WorkStage = {
  id: "ship",
  kind: "skill",
  skill: "",
  name: "Ship",
  executors: [],
  automation: { source: "flow", steps: ["git.commit", "script:s1"], scripts: [{ id: "s1", name: "deploy.sh", content: "echo" }] },
};
/** Связка: под-этап до владельца, владелец, под-этап после — и отдельный этап рядом. */
const linked = [skill("spec", { parent: "practice" }), skill("practice"), { ...shipping, parent: "practice" }, review, skill("demo")];
const practice = linked[1]!;

const ids = (prefix: string) => {
  let n = 0;
  return () => `${prefix}${++n}`;
};

describe("шаблон этапа — этап целиком без места в flow", () => {
  it("этап без под-этапов ложится без id и без поля под-этапов; повтор того же этапа список не меняет", () => {
    const once = saveTemplate([], [review], review);
    expect(once).toEqual([{ kind: "skill", skill: "code-review", name: "code-review", icon: "Search", executors: [reviewer] }]);
    expect(saveTemplate(once, [review], { ...review, id: "other" })).toBe(once);
  });

  it("этап с под-этапами ложится вместе с ними: в их порядке, стоящие до владельца помечены", () => {
    const [template] = saveTemplate([], linked, practice);
    expect(template?.name).toBe("practice");
    expect(template?.subStages?.map((sub) => [sub.name, sub.before === true])).toEqual([
      ["spec", true],
      ["Ship", false],
    ]);
    expect(template?.subStages?.some((sub) => "id" in sub || "parent" in sub)).toBe(false);
  });

  it("сохранён ли этап, видно и у его копии; другие под-этапы — другой шаблон", () => {
    const saved = saveTemplate([], linked, practice);
    expect(isTemplateSaved(saved, linked, practice)).toBe(true);
    expect(isTemplateSaved(saved, [practice], practice)).toBe(false);
    expect(isTemplateSaved(saveTemplate([], [practice], practice), linked, practice)).toBe(false);
  });

  it("из шаблона встаёт вся связка: под-этапы на своих местах под новым владельцем, у всех новые id", () => {
    const saved = saveTemplate([], linked, practice);
    const stages = stagesFromTemplate(saved[0]!, ids("st"), ids("sc"));
    expect(stages.map((s) => [s.id, s.name, s.parent])).toEqual([
      ["st2", "spec", "st1"],
      ["st1", "practice", undefined],
      ["st3", "Ship", "st1"],
    ]);
    expect(isTemplateSaved(saved, stages, stages[1]!)).toBe(true);
  });

  it("скрипты получают новые id и сравниваются именем и содержимым", () => {
    const saved = saveTemplate([], [shipping], shipping);
    const [stage] = stagesFromTemplate(saved[0]!, ids("st"), ids("sc"));
    expect(stage?.automation).toEqual({ source: "flow", steps: ["git.commit", "script:sc1"], scripts: [{ id: "sc1", name: "deploy.sh", content: "echo" }] });
    expect(isTemplateSaved(saved, [stage!], stage!)).toBe(true);
  });

  it("крест убирает шаблон по месту, остальные на местах", () => {
    const two = saveTemplate(saveTemplate([], [review], review), [shipping], shipping);
    expect(removeTemplate(two, 0)).toEqual([two[1]]);
  });

  it("шаблон с под-этапами переживает разбор настроек и узнаётся после перезагрузки", () => {
    const templates: StageTemplate[] = [...saveTemplate([], linked, practice)];
    const parsed = flowSettingsSchema.parse({ flows: [{ id: "f", name: "F", stages: linked }], minButtonWidth: 170, stageTemplates: templates });
    expect(parsed.stageTemplates).toEqual(templates);
    expect(isTemplateSaved(parsed.stageTemplates ?? [], parsed.flows[0]!.stages, parsed.flows[0]!.stages[1]!)).toBe(true);
  });
});

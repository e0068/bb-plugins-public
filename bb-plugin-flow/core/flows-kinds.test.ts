// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { stageKindOf } from "../lib/stage-constants";
import type { FlowSettings, WorkStage } from "../shared/contract";
import { addFlow, DEFAULT_STAGES, defaultFlow, flowById, flowOrNone, fromLegacy, migrateFlows, newFlow, NO_FLOW, removeFlow, renameFlow, setFlowStages, stageSettingsOf } from "./flows";
import { planner } from "./stages-fixtures";

const ids = (stages: readonly { id: string }[]) => stages.map((s) => s.id);
const kinds = (stages: readonly WorkStage[]) => stages.map(stageKindOf);
const skill = (id: string, review = false): WorkStage => ({ id, skill: id, name: id, review, executors: [] });
const old = (stages: WorkStage[]): FlowSettings => ({ flows: [{ id: "default", name: "Default", stages }], minButtonWidth: 170 });

const two: FlowSettings = { flows: [newFlow("default", "Default"), newFlow("quick", "Quick")], minButtonWidth: 200, version: 2 };

describe("этапы по умолчанию", () => {
  it("Вопросы, Критерии, Выбор этапов, работа с Демонстрацией после прототипа и в конце", () => {
    expect(kinds(DEFAULT_STAGES)).toEqual(["questions", "criteria", "select", "skill", "skill", "demo", "skill", "skill", "skill", "skill", "skill", "demo"]);
    expect(new Set(ids(DEFAULT_STAGES)).size).toBe(DEFAULT_STAGES.length);
    expect(DEFAULT_STAGES.every((s) => s.review === undefined)).toBe(true);
  });
});

describe("перенос flow в версию 2", () => {
  it("Уточнение и Критерии получают виды, Выбор этапов встаёт за ними, за этапом с Review — Демонстрация", () => {
    const migrated = migrateFlows(old([{ id: "clarify", skill: "", name: "Clarification", review: false, executors: [] }, { id: "criteria", skill: "", name: "Criteria", review: false, executors: [] }, skill("task", true), skill("code")]));
    const stages = migrated.flows[0]!.stages;
    expect(migrated.version).toBe(2);
    expect(kinds(stages)).toEqual(["questions", "criteria", "select", "skill", "demo", "skill"]);
    expect(ids(stages).slice(0, 4)).toEqual(["clarify", "criteria", "select", "task"]);
    expect(stages.every((s) => s.review === undefined && s.kind !== undefined)).toBe(true);
  });

  it("flow без ведущих встроенных этапов получает Выбор этапов первым", () => {
    expect(kinds(migrateFlows(old([skill("task"), skill("plan")])).flows[0]!.stages)).toEqual(["select", "skill", "skill"]);
  });

  it("исполнители этапов сохраняются", () => {
    const stages = migrateFlows(old([{ ...skill("plan"), executors: [planner] }])).flows[0]!.stages;
    expect(stages.find((s) => s.id === "plan")?.executors).toEqual([planner]);
  });

  it("коллекция версии 2 не переносится", () => {
    const current: FlowSettings = { ...old([skill("task")]), version: 2 };
    expect(migrateFlows(current)).toBe(current);
  });

  it("перенос идемпотентен, id уникальны, этапы навыков сохраняют порядок", () => {
    const stageArb = fc.record({ id: fc.stringMatching(/^[a-z]{1,6}$/), review: fc.boolean() });
    fc.assert(
      fc.property(fc.uniqueArray(stageArb, { selector: (s) => s.id, maxLength: 8 }), (list) => {
        const once = migrateFlows(old(list.map((s) => skill(s.id, s.review))));
        const stages = once.flows[0]!.stages;
        expect(migrateFlows(once)).toBe(once);
        expect(new Set(ids(stages)).size).toBe(stages.length);
        const skillIds = stages.filter((s) => stageKindOf(s) === "skill").map((s) => s.id);
        expect(skillIds).toEqual(list.map((s) => s.id).filter((id) => stageKindOf({ id }) === "skill"));
      }),
    );
  });
});

describe("коллекция flow", () => {
  it("старый список этапов становится flow Default версии 2 и прежней шириной кнопки", () => {
    const settings = fromLegacy({ stages: [skill("task", true), { ...skill("plan"), executors: [planner] }], minButtonWidth: 220 });
    expect(settings.version).toBe(2);
    expect(kinds(settings.flows[0]!.stages)).toEqual(["questions", "criteria", "select", "skill", "demo", "skill"]);
    expect(settings.minButtonWidth).toBe(220);
  });

  it("без старой записи — один flow Default с этапами по умолчанию", () => {
    const settings = fromLegacy(undefined);
    expect(settings.version).toBe(2);
    expect(settings.flows.map((f) => f.id)).toEqual(["default"]);
    expect(settings.flows[0]!.stages).toEqual(DEFAULT_STAGES);
  });

  it("новый flow получает этапы по умолчанию и встаёт в конец списка", () => {
    const settings = addFlow(two, newFlow("big", "Big feature"));
    expect(settings.flows.map((f) => f.id)).toEqual(["default", "quick", "big"]);
    expect(settings.flows[2]!.stages).toEqual(DEFAULT_STAGES);
  });

  it("имя flow правится с обрезкой пробелов, пустое имя не переименовывает", () => {
    expect(renameFlow(two, "quick", "  Мелочь ").flows[1]!.name).toBe("Мелочь");
    expect(renameFlow(two, "quick", "   ")).toBe(two);
  });

  it("flow удаляется, последний flow остаётся", () => {
    const one = removeFlow(two, "quick");
    expect(one.flows.map((f) => f.id)).toEqual(["default"]);
    expect(removeFlow(one, "default")).toBe(one);
  });

  it("правка этапов меняет только свой flow", () => {
    const settings = setFlowStages(two, "quick", (stages) => stages.filter((s) => stageKindOf(s) !== "select"));
    expect(kinds(settings.flows[1]!.stages)).not.toContain("select");
    expect(kinds(settings.flows[0]!.stages)).toContain("select");
  });

  it("flow по умолчанию — первый в списке; неизвестный или удалённый id даёт его же", () => {
    expect(defaultFlow(two).id).toBe("default");
    expect(flowById(two, "quick").id).toBe("quick");
    expect(flowById(two, "gone").id).toBe("default");
    expect(flowById(two, undefined).id).toBe("default");
  });

  it("«без flow» — не flow: отдаётся отсутствие, а не flow по умолчанию", () => {
    expect(flowOrNone(two, NO_FLOW)).toBeNull();
    expect(flowOrNone(two, "quick")?.id).toBe("quick");
    expect(flowOrNone(two, "gone")?.id).toBe("default");
    expect(flowOrNone(two, undefined)?.id).toBe("default");
    expect(two.flows.map((flow) => flow.id)).not.toContain(NO_FLOW);
  });

  it("этапы flow с общей шириной кнопки — то, что проверяет бриф и видят инструкции", () => {
    expect(stageSettingsOf(two, two.flows[1]!)).toEqual({ stages: two.flows[1]!.stages, minButtonWidth: 200 });
  });
});

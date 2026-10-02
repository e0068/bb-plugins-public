// @vitest-environment node
import { describe, expect, it } from "vitest";

import { flowSchema, progressStageSchema, stageSettingsSchema } from "./contract";

const stage = (id: string, parent?: string) => ({ id, skill: id, name: id, executors: [], ...(parent === undefined ? {} : { parent }) });
const flow = (stages: unknown[]) => ({ id: "plugin", name: "BB Plugin", stages });
const accepts = (stages: unknown[]) => flowSchema.safeParse(flow(stages)).success;

describe("под-этапы в схеме flow", () => {
  it("связка до и после владельца принимается", () => {
    expect(accepts([stage("ship"), stage("preview", "demo"), stage("demo"), stage("restore", "demo"), stage("merge")])).toBe(true);
  });

  it("flow без под-этапов читается без изменений", () => {
    const stages = [stage("ship"), stage("demo")];
    expect(flowSchema.parse(flow(stages)).stages).toEqual(stages);
  });

  it("под-этап с владельцем вне flow не принимается", () => {
    expect(accepts([stage("preview", "demo"), stage("ship")])).toBe(false);
  });

  it("этап, который сам себе владелец, не принимается", () => {
    expect(accepts([stage("demo", "demo")])).toBe(false);
  });

  it("вложенность глубже одного уровня не принимается", () => {
    expect(accepts([stage("repoint", "preview"), stage("preview", "demo"), stage("demo")])).toBe(false);
  });

  it("разорванная связка не принимается: между под-этапом и владельцем чужой этап", () => {
    expect(accepts([stage("preview", "demo"), stage("ship"), stage("demo")])).toBe(false);
    expect(accepts([stage("demo"), stage("ship"), stage("restore", "demo")])).toBe(false);
  });

  it("таблица настроек старого вида держит те же правила", () => {
    expect(stageSettingsSchema.safeParse({ stages: [stage("preview", "demo"), stage("demo")], minButtonWidth: 170 }).success).toBe(true);
    expect(stageSettingsSchema.safeParse({ stages: [stage("preview", "nowhere")], minButtonWidth: 170 }).success).toBe(false);
  });

  it("строка полосы прогресса несёт владельца под-этапа", () => {
    const row = { id: "preview", kind: "skill", name: "Preview", executor: "self", state: "todo", results: [], number: null, minutes: null, cost: null, parent: "demo" };
    expect(progressStageSchema.parse(row).parent).toBe("demo");
  });
});

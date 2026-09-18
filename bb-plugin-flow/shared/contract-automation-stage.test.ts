// @vitest-environment node
import { describe, expect, it } from "vitest";

import { automationStage, automationStageId } from "../lib/stage-constants";
import { flowSchema, workStageSchema } from "./contract";

describe("этап-автоматизация", () => {
  it("этап без автоматизации читается как раньше, с ней — со снимком имени", () => {
    expect(workStageSchema.safeParse({ id: "spec", skill: "spec", name: "Спека", review: false, executors: [] }).success).toBe(true);
    const parsed = workStageSchema.parse({ ...automationStage({ id: "click-pr", name: "Pull Request" }) });
    expect(parsed.automation).toEqual({ id: "click-pr", name: "Pull Request" });
  });

  it("одна автоматизация дважды в flow — повтор id этапа", () => {
    const stage = automationStage({ id: "click-pr", name: "Pull Request" });
    expect(flowSchema.safeParse({ id: "f", name: "F", stages: [stage, stage] }).success).toBe(false);
  });

  it("пустое имя или id автоматизации не проходит", () => {
    expect(workStageSchema.safeParse({ ...automationStage({ id: "x", name: "X" }), automation: { id: "x", name: " " } }).success).toBe(false);
  });
});

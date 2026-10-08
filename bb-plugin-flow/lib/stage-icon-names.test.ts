import { describe, expect, it } from "vitest";
import { AUTOMATION_ICON, EXECUTOR_ICONS, KIND_ICONS, stageIconName } from "./stage-icon-names";

describe("значок этапа без своего", () => {
  it("Action — запуск, даже если у него есть шаги", () => {
    expect(stageIconName({ kind: "action", executor: "self", automation: true })).toBe(KIND_ICONS.action);
  });

  it("этап с шагами автоматизации — значок автоматизации", () => {
    expect(stageIconName({ kind: "skill", executor: "self", automation: true })).toBe(AUTOMATION_ICON);
  });

  it("этап навыка — знак своего исполнителя", () => {
    for (const executor of ["self", "agent", "workflow"] as const) {
      expect(stageIconName({ kind: "skill", executor, automation: false })).toBe(EXECUTOR_ICONS[executor]);
    }
  });

  it("встроенный этап — знак своего вида", () => {
    for (const kind of ["questions", "criteria", "select", "demo"] as const) {
      expect(stageIconName({ kind, executor: "self", automation: false })).toBe(KIND_ICONS[kind]);
    }
  });
});

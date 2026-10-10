import { describe, expect, it } from "vitest";
import { AUTOMATION_ICON, KIND_ICONS, SKILL_ICON, stageIconName } from "./stage-icon-names";

describe("значок этапа без своего", () => {
  it("Action — запуск, даже если у него есть шаги", () => {
    expect(stageIconName({ kind: "action", automation: true })).toBe(KIND_ICONS.action);
  });

  it("этап с шагами автоматизации — значок автоматизации", () => {
    expect(stageIconName({ kind: "skill", automation: true })).toBe(AUTOMATION_ICON);
  });

  it("этап навыка — книга, как на странице Flow, кто бы его ни вёл", () => {
    expect(stageIconName({ kind: "skill", automation: false })).toBe(SKILL_ICON);
  });

  it("встроенный этап — знак своего вида", () => {
    for (const kind of ["questions", "criteria", "select", "demo"] as const) {
      expect(stageIconName({ kind, automation: false })).toBe(KIND_ICONS[kind]);
    }
  });
});

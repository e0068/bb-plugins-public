// @vitest-environment node
import { describe, expect, it } from "vitest";

import { AUTOMATION_ICON, EXECUTOR_ICONS, KIND_ICONS } from "../../lib/stage-icon-names";
import { STAGE_ICONS } from "./stage-icon-catalog";
import { kindGlyph, stageGlyph } from "./stage-glyphs";

describe("рисунок значка этапа", () => {
  it("у каждого запасного значка этапа прогона есть рисунок", () => {
    for (const name of [...Object.values(KIND_ICONS), ...Object.values(EXECUTOR_ICONS), AUTOMATION_ICON]) {
      expect(kindGlyph(name), name).toBeDefined();
    }
  });

  it("свой значок владельца берётся из каталога, даже если запасной другой", () => {
    expect(stageGlyph({ icon: "Album01", fallbackIcon: EXECUTOR_ICONS.self })).toBe(STAGE_ICONS.get("Album01"));
  });

  it("без своего значка — запасной по виду", () => {
    expect(stageGlyph({ icon: undefined, fallbackIcon: KIND_ICONS.demo })).toBe(kindGlyph(KIND_ICONS.demo));
  });

  it("свой значок, пропавший из каталога, уступает запасному", () => {
    expect(stageGlyph({ icon: "NoSuchIcon", fallbackIcon: EXECUTOR_ICONS.agent })).toBe(kindGlyph(EXECUTOR_ICONS.agent));
  });

  it("неизвестное запасное имя — значок автоматизации, а не пустота", () => {
    expect(stageGlyph({ icon: undefined, fallbackIcon: "NoSuchIcon" })).toBe(kindGlyph(AUTOMATION_ICON));
  });
});

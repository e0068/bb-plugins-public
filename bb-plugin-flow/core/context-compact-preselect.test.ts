import { describe, expect, it } from "vitest";

import { COMPACT_PRESELECT_LABELS, compactPreselectOf, preselectsCompact, type CompactPreselect, type ContextTone } from "./context";

const tones: readonly ContextTone[] = ["normal", "warn", "alert"];

describe("предвыбор компактации по зоне контекста", () => {
  it.each<[CompactPreselect, readonly ContextTone[]]>([
    ["never", []],
    ["warn", ["warn", "alert"]],
    ["alert", ["alert"]],
  ])("«%s» предвыбирает компактацию ровно в зонах %j", (preselect, zones) => {
    expect(tones.filter((tone) => preselectsCompact(preselect, tone))).toEqual(zones);
  });

  it("подпись варианта в настройке читается обратно в тот же вариант", () => {
    for (const [preselect, label] of Object.entries(COMPACT_PRESELECT_LABELS)) expect(compactPreselectOf(label)).toBe(preselect);
  });
});

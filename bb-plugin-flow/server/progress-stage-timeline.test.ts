// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { STAGE_ICONS } from "../components/ui/stage-icon-catalog";
import { KIND_GLYPHS } from "../components/ui/stage-glyphs";
import { stage } from "../core/stages-fixtures";
import { timelineStageSchema, type StageSettings } from "../shared/contract";
import { createProgress, registerProgress } from "./progress";

const THREAD = "thr_run";
const at = (minute: number) => `2026-10-08T10:${String(minute).padStart(2, "0")}:00.000Z`;

const setup = async () => {
  const settings: StageSettings = { stages: [stage("prototype", { name: "Prototype", icon: "Album01" }), stage("review", { name: "code-review" })], minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const progress = createProgress(bb.storage.kv);
  const thread = async () => ({ active: false, providerId: null, environmentId: null });
  registerProgress(bb, progress, { now: () => at(0), stages: () => settings, windowCost: async () => undefined, thread });
  const timeline = async (threadId = THREAD) => timelineStageSchema.array().parse(await harness.callRpc("getStageTimeline", { threadId }));
  return { progress, timeline };
};

describe("этапы треда для шкал других плагинов", () => {
  it("отдаёт этапы прогона с проходами, названием и рисунком значка", async () => {
    const { progress, timeline } = await setup();
    await progress.update(THREAD, () => ({
      stages: { prototype: { startedAt: at(20), finishedAt: at(30), earlier: { cost: 0, minutes: 10, wall: 10, from: at(0) }, passes: [{ from: at(0), to: at(10) }] }, review: { startedAt: at(31) } },
      waiting: [],
    }));
    expect(await timeline()).toEqual([
      { id: "prototype", name: "Prototype", glyph: STAGE_ICONS.get("Album01"), passes: [{ from: at(0), to: at(10) }, { from: at(20), to: at(30) }] },
      { id: "review", name: "code-review", glyph: KIND_GLYPHS.BookOpen, passes: [{ from: at(31), to: null }] },
    ]);
  });

  it("тред без прогона — пустой список, а не ошибка", async () => {
    const { timeline } = await setup();
    expect(await timeline("thr_without_flow")).toEqual([]);
  });
});

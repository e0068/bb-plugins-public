// @vitest-environment node
import { describe, expect, it } from "vitest";

import { report, stage, stagedBrief } from "../core/stages-fixtures";
import { stageItems } from "../core/stages";
import { emptyDraft, toAnswer, toggleStageRun, type Draft } from "./draft";

// Демонстрация со связкой: Preview до неё, Restore после; агент рекомендует взять всё.
const brief = stagedBrief(["preview", "demo", "restore"].map((id) => report(id, { recommended: true })), {
  stages: { list: [stage("preview", { parent: "demo" }), stage("demo"), stage("restore", { parent: "demo" })], minButtonWidth: 170 },
});
const item = (id: string) => stageItems(brief).find((i) => i.stage.id === id)!;
const runs = (draft: Draft) => Object.fromEntries((toAnswer(brief, draft).stages ?? []).map((s) => [s.id, s.run]));

describe("галочка связки в черновике брифа", () => {
  it("снятый владелец снимает под-этапы, и ответ несёт это у каждого", () => {
    expect(runs(toggleStageRun(brief, emptyDraft(), item("demo")))).toEqual({ preview: false, demo: false, restore: false });
  });

  it("снятый под-этап уходит один", () => {
    expect(runs(toggleStageRun(brief, emptyDraft(), item("restore")))).toEqual({ preview: true, demo: true, restore: false });
  });

  it("возвращённый под-этап возвращает и владельца", () => {
    const off = toggleStageRun(brief, emptyDraft(), item("demo"));
    expect(runs(toggleStageRun(brief, off, item("restore")))).toEqual({ preview: false, demo: true, restore: true });
  });
});

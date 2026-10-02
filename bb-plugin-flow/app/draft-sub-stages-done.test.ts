// @vitest-environment node
import { describe, expect, it } from "vitest";

import { report, stage, stagedBrief } from "../core/stages-fixtures";
import { stageItems } from "../core/stages";
import { emptyDraft, toggleStageRun } from "./draft";

// Preview уже пройден, Демонстрация и Restore впереди.
const brief = stagedBrief(
  [report("preview", { state: "done", results: [{ label: "repoint", target: "docs/x.md" }] }), report("demo", { recommended: true }), report("restore", { recommended: true })],
  { stages: { list: [stage("preview", { parent: "demo" }), stage("demo"), stage("restore", { parent: "demo" })], minButtonWidth: 170 } },
);

describe("галочка связки в брифе и пройденный под-этап", () => {
  it("снятый владелец не трогает выбор пройденного под-этапа", () => {
    const demo = stageItems(brief).find((i) => i.stage.id === "demo")!;
    expect(toggleStageRun(brief, emptyDraft(), demo).stages).toEqual({ demo: { run: false }, restore: { run: false } });
  });
});

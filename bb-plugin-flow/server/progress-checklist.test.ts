// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import type { ChecklistItem, StageSettings } from "../shared/contract";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";

const THREAD = "thr_check";
const settings: StageSettings = { stages: [stage("spec"), stage("code")], minButtonWidth: 170 };

const host = (items: ChecklistItem[]) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const progress = createProgress(bb.storage.kv);
  registerProgress(bb, progress, { now: () => "2026-10-13T10:00:00.000Z", stages: () => settings, windowCost: async () => undefined, checklist: async () => items });
  const mark = (state: "started" | "done", id = "spec") => harness.callAgentTool(FLOW_STAGE_TOOL, { stage: id, state }, { threadId: THREAD });
  return { mark };
};

const textOf = (result: unknown): string => (typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join(""));

describe("чек-лист по комментариям держит следующий этап", () => {
  it("открытый пункт — этап не начинается, отказ называет пункт и инструмент", async () => {
    const { mark } = host([{ id: "c1", where: "Вопросы", text: "без лишних файлов", done: false }]);
    const result = await mark("started");
    expect(result).toMatchObject({ isError: true });
    expect(textOf(result)).toContain("c1 [ ] Вопросы: без лишних файлов");
    expect(textOf(result)).toContain("flow_checklist");
  });

  it("закрытый чек-лист этапу не мешает", async () => {
    const { mark } = host([{ id: "c1", where: "Вопросы", text: "x", done: true }]);
    expect(textOf(await mark("started"))).not.toContain("checklist");
  });
});

// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import type { ChecklistItem, StageSettings } from "../shared/contract";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";

const THREAD = "thr_rollback";
const settings: StageSettings = { stages: [stage("spec"), stage("code")], minButtonWidth: 170 };

/** Чек-лист появляется посреди прогона — как после «на доработку» у Утверждения за закрытым этапом. */
const host = () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const progress = createProgress(bb.storage.kv);
  let items: ChecklistItem[] = [];
  registerProgress(bb, progress, { now: () => "2026-10-29T10:00:00.000Z", stages: () => settings, windowCost: async () => undefined, checklist: async () => items });
  const mark = (id: string, state: "started" | "done") => harness.callAgentTool(FLOW_STAGE_TOOL, { stage: id, state }, { threadId: THREAD });
  const open = () => void (items = [{ id: "c1", where: "Демонстрация", text: "кнопка слишком яркая", done: false }]);
  return { mark, open };
};

describe("доработка по комментариям: откат к закрытому этапу не ждёт чек-листа", () => {
  it("откат к закрытому этапу проходит при открытом пункте, а следующий за ним этап ждёт, пока пункт не отмечен", async () => {
    const { mark, open } = host();
    await mark("spec", "started");
    await mark("spec", "done");
    open();
    expect(await mark("spec", "started")).not.toMatchObject({ isError: true });
    await mark("spec", "done");
    expect(await mark("code", "started")).toMatchObject({ isError: true });
  });
});

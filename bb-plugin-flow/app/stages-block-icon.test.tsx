// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { report, stage, stagedBrief } from "../core/stages-fixtures";
import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = stagedBrief([report("spec", { recommended: true }), report("plan")], {
  stages: { list: [stage("spec", { name: "Спека", icon: "Rocket" }), stage("plan", { name: "План" })], minButtonWidth: 170 },
});

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: (() => ({ kind: "not_found" })) as never } },
  );

describe("иконка этапа в брифе", () => {
  it("кнопка этапа с выбранной иконкой показывает её перед названием, этап без неё — без иконки", async () => {
    const slot = open();
    await slot.findByRole("group", { name: "Ответ на бриф" });
    expect(slot.container.querySelector('[data-stage="spec"] [data-icon="Rocket"]')).not.toBeNull();
    expect(slot.container.querySelector('[data-stage="plan"] svg[data-icon]')?.getAttribute("data-icon") ?? null).not.toBe("Rocket");
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { STAGES, report, stage, stagedBrief } from "../core/stages-fixtures";
import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const demo = stage("demo", { name: "Показ", parent: "plan" });
const brief = stagedBrief([report("plan", { recommended: true }), report("demo", { recommended: true })], { stages: { list: [...STAGES, demo], minButtonWidth: 170 } });

const open = (b: DecisionBrief) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: b.id }, source: `::decision{id="${b.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief: b, answer: null }), answerBrief: () => ({ kind: "not_found" }), ...({ threadFiles } as object) } },
  );

const row = async (slot: ReturnType<typeof open>, stageId: string) => {
  await slot.findByRole("group", { name: "Этапы и бюджет" });
  return slot.container.querySelector<HTMLElement>(`[data-stage="${stageId}"]`)!;
};

describe("чекбокс под-этапа в таблице брифа", () => {
  it("не нажимается: под-этап снимается только вместе с этапом-владельцем", async () => {
    const slot = open(brief);
    const box = within(await row(slot, "demo")).getByRole("checkbox", { name: "Под-этап Показ этапа План в прогоне" });
    expect(box.tagName).not.toBe("BUTTON");
    expect(box.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(box);
    expect(within(await row(slot, "demo")).getByRole("checkbox", { name: "Под-этап Показ этапа План в прогоне" }).getAttribute("aria-checked")).toBe("true");
  });

  it("снятый владелец гасит и под-этап", async () => {
    const slot = open(brief);
    fireEvent.click(within(await row(slot, "plan")).getByRole("checkbox", { name: "План: в ближайший прогон" }));
    expect(within(await row(slot, "demo")).getByRole("checkbox", { name: "Под-этап Показ этапа План в прогоне" }).getAttribute("aria-checked")).toBe("false");
  });
});

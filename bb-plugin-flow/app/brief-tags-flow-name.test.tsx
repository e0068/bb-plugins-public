// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { STAGES, report, stagedBrief } from "../core/stages-fixtures";
import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const open = (b: DecisionBrief) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: b.id }, source: `::decision{id="${b.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief: b, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
  );

const selectTag = async (b: DecisionBrief) => {
  const slot = open(b);
  await slot.findByRole("group", { name: "Ответ на бриф" });
  return [...slot.container.querySelectorAll("[data-section-tag]")].map((el) => el.textContent).at(-1);
};

describe("название flow в бирке Выбора этапов", () => {
  it("бриф, записанный с названием flow, пишет его в бирке через точку", async () => {
    const brief = stagedBrief([report("task", { recommended: true })], { stages: { list: STAGES, minButtonWidth: 170, flowName: "Code" } });
    expect(await selectTag(brief)).toBe("Выбор этапов · Code");
  });

  it("бриф без названия flow — бирка как раньше, без точки", async () => {
    expect(await selectTag(stagedBrief([report("task", { recommended: true })]))).toBe("Выбор этапов");
  });
});

// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief, decisionsRpcContract, dispatchRpcContract } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

/** Бриф Демонстрации треда «Проверить, какие баги ещё открыты»: вопросов нет, а scope агент прислал. */
const brief: DecisionBrief = {
  id: "dec_demo_scope",
  threadId: "thr_1",
  title: "Навыки снова видны",
  scope: "Пункты 1 и 3а из отчёта об ошибках Flow 0.6.56",
  createdAt: "2026-10-02T10:00:00.000Z",
  kind: "brief",
  revocable: true,
  launched: true,
  questions: [],
  outcome: { stage: "demo", final: false, next: "Публикация", done: ["Навыки грузятся"], pending: [], results: [{ label: "PR #636", target: "https://github.com/e0068/bb-plugins/pull/636" }] },
  stages: { list: [{ ...builtinStage("demo", []), name: "Демонстрация" }], minButtonWidth: 160 },
};

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }), getDispatchPlace: () => ({ place: "here" }), listProjects: () => ({ kind: "found" as const, projects: [] }), ...({ threadFiles } as object) } },
  );

describe("Демонстрация без «Что я понял»", () => {
  it("scope брифа с итогом не рисуется, бирки «Вопросы» нет", async () => {
    const slot = open();
    await slot.findByRole("group", { name: "Демонстрация" });
    expect(slot.queryByText("Что я понял")).toBeNull();
    expect(slot.queryByText(brief.scope!)).toBeNull();
    expect([...slot.container.querySelectorAll("[data-section-tag]")].map((el) => el.textContent)).not.toContain("Вопросы");
  });
});

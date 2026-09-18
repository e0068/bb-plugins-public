// @vitest-environment jsdom
import { cleanup, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Artifact, DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const approved = (id: string, name: string): Artifact => ({ id, name, state: "approved", recommended: false, link: { label: `${id}.md`, target: `${id}.md` } });

// Бриф, записанный до отзыва утверждений: без метки `revocable`.
const old = (artifacts: Artifact[]): DecisionBrief => ({
  id: "dec_old",
  threadId: "thr_1",
  title: "Старый бриф",
  createdAt: "2026-09-12T00:00:00.000Z",
  kind: "brief",
  setup: { artifacts },
  questions: [{ id: "read", question: "Так?", kind: "confirm", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: true }] }],
});

const open = (brief: DecisionBrief) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
  );

describe("утверждённый артефакт в брифе, записанном до отзыва утверждений", () => {
  it("отмечен и без кнопки-переключателя, имя документа открывается", async () => {
    const group = within(await open(old([approved("task", "Задача"), { id: "spec", name: "Спека", state: "missing", recommended: true }])).findByRole("group", { name: "Артефакты" }));
    expect(group.queryByRole("button", { name: /^Задача:/ })).toBeNull();
    expect(group.getByRole("button", { name: "task.md" })).toBeTruthy();
    expect(group.getByText("task.md").closest("[data-artifact]")?.getAttribute("data-checked")).toBe("true");
    expect(group.getByRole("button", { name: "Спека: сделать" })).toBeTruthy();
  });

  it("блок артефактов рисуется, даже когда утверждены все", async () => {
    const group = within(await open(old([approved("task", "Задача"), approved("spec", "Спека")])).findByRole("group", { name: "Артефакты" }));
    expect(group.getByRole("button", { name: "spec.md" })).toBeTruthy();
  });
});

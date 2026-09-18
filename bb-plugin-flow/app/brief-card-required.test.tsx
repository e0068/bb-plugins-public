// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_required",
  threadId: "thr_1",
  title: "Обязательные документы",
  createdAt: "2026-09-13T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  required: { make: ["spec"], approve: ["prototype"] },
  setup: {
    artifacts: [
      { id: "task", name: "Задача", state: "missing", recommended: true },
      { id: "prototype", name: "HTML-прототип", state: "ready", recommended: true, link: { label: "p.html", target: "p.html" } },
      { id: "spec", name: "Спецификация", state: "missing", recommended: true },
      { id: "plan", name: "План", state: "missing", recommended: false },
    ],
  },
  questions: [],
};

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
  );

describe("обязательный документ в брифе", () => {
  it("галочку у обязательного документа ставит владелец: при открытии она снята, у необязательного рекомендованного — стоит", async () => {
    const group = within(await open().findByRole("group", { name: "Артефакты" }));
    expect(group.getByRole("button", { name: /^Спецификация: сделать/ }).getAttribute("aria-pressed")).toBe("false");
    expect(group.getByRole("button", { name: /^HTML-прототип: утвердить/ }).getAttribute("aria-pressed")).toBe("false");
    expect(group.getByRole("button", { name: /^Задача: сделать/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("пока галочек нет, счётчик не сходится, отправить нельзя, и подсказка называет документы", async () => {
    const slot = open();
    expect(await slot.findByText("Отметь обязательные документы: HTML-прототип, Спецификация")).toBeTruthy();
    expect(slot.getByText("заполнено 0/1")).toBeTruthy();
    expect(slot.getByRole("button", { name: "Отправить бриф" }).hasAttribute("disabled")).toBe(true);
    const group = within(slot.getByRole("group", { name: "Артефакты" }));
    fireEvent.click(group.getByRole("button", { name: /^Спецификация: сделать/ }));
    fireEvent.click(group.getByRole("button", { name: /^HTML-прототип: утвердить/ }));
    expect(slot.queryByText(/Отметь обязательные документы/)).toBeNull();
    expect(slot.queryByText(/заполнено/)).toBeNull();
    expect(slot.getByRole("button", { name: "Отправить бриф" }).hasAttribute("disabled")).toBe(false);
  });
});


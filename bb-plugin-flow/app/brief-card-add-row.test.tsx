// @vitest-environment jsdom
import { cleanup, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_add_row",
  threadId: "thr_1",
  title: "Строки ввода",
  createdAt: "2026-09-16T00:00:00.000Z",
  kind: "brief",
  setup: { criteria: ["Пункт"] },
  questions: [
    { id: "how", question: "Как сделать?", kind: "fork", allowOwn: false, options: [{ id: "a", action: "Так", recommended: true, description: "…", add: { target: 0, max: 0, risk: 0 } }] },
    { id: "ok", question: "Верно понял?", kind: "confirm", allowOwn: false, options: [{ id: "yes", action: "Yes", recommended: false }] },
  ],
};

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: (() => ({ kind: "found", brief, answer: null })) as never, answerBrief: (() => ({ kind: "not_found" })) as never }, settings: { language: "Русский" } },
  );

/** Строка ввода, в которой лежит поле с этим именем. */
const rowOf = async (slot: ReturnType<typeof open>, name: string) => within((await slot.findByRole("textbox", { name })).closest<HTMLElement>("[data-item-row]")!);

describe("строки «Дополнить» и «Свой ответ»", () => {
  it("у критерия и у всего брифа — строка «Дополнить» с «+» картинок", async () => {
    const slot = open();
    expect((await rowOf(slot, "Дополнить")).getByRole("button", { name: "Приложить изображение" })).toBeTruthy();
    const note = await rowOf(slot, "Дополнить бриф");
    expect(note.getByRole("button", { name: "Приложить изображение" })).toBeTruthy();
    expect((note.getByRole("textbox") as HTMLTextAreaElement).placeholder).toBe("Дополнить");
  });

  it("свой ответ у варианта и у подтверждения — той же строкой, с «+» картинок", async () => {
    const slot = open();
    for (const question of ["Как сделать?", "Верно понял?"]) {
      const group = within(await slot.findByRole("group", { name: question }));
      const field = group.getByRole("textbox", { name: "Свой ответ" });
      expect(within(field.closest<HTMLElement>("[data-item-row]")!).getByRole("button", { name: "Приложить изображение" })).toBeTruthy();
    }
  });

  it("счётчик незакрытого — подпись внутри кнопки отправки, над «Отправить»", async () => {
    const slot = open();
    const send = await slot.findByRole("button", { name: "Отправить бриф" });
    expect(send.getAttribute("aria-description")).toBe("заполнено 0/2");
    expect(send.textContent).toBe("заполнено 0/2Отправить");
  });
});

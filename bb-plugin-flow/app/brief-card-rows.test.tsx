// @vitest-environment jsdom
import { cleanup, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief, decisionsRpcContract, voiceRpcContract } from "../shared/contract";
import { storeDraft } from "./draft-storage";
import { initialDraft, setAddedCriterion } from "./draft";
import { installMicrophone, uninstallMicrophone } from "./voice-fakes";

const app = await loadPluginApp(() => import("../app"));

const brief: DecisionBrief = {
  id: "dec_rows",
  threadId: "thr_1",
  title: "Строки пунктов",
  createdAt: "2026-09-14T00:00:00.000Z",
  kind: "brief",
  setup: { criteria: ["Короткий пункт", "Длинный пункт, который переносится на несколько строк и растягивает строку по высоте"] },
  questions: [],
};

type Contract = typeof decisionsRpcContract & typeof voiceRpcContract;

const open = () =>
  renderSlot<PluginMessageDirectiveProps, Contract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: null },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief, answer: null }),
        answerBrief: ({ answer }: { answer: DecisionAnswer }) => ({ kind: "accepted", record: { answer, messageId: "msg_1", answeredAt: "2026-09-14T10:00:00.000Z" } }),
        transcribeVoice: () => ({ kind: "transcribed", text: "Привет" }),
      },
    },
  );

beforeEach(() => {
  window.localStorage.clear();
  installMicrophone();
});
afterEach(() => {
  cleanup();
  uninstallMicrophone();
});

/** Строка пункта — ближайший предок поля с меткой номера. */
const rowOf = (field: HTMLElement): HTMLElement => field.closest("[data-item-row]") as HTMLElement;

describe("строки «Готово, когда»", () => {
  it("строка пункта выравнивает номер, микрофон и крест по центру", async () => {
    const criteria = within(await open().findByRole("group", { name: "Готово, когда" }));
    const row = rowOf(criteria.getByRole("textbox", { name: "Пункт 2" }));
    expect(row.className).toContain("items-center");
    expect(row.className).not.toContain("items-start");
    for (const child of Array.from(row.children) as HTMLElement[]) expect(child.className).not.toMatch(/\bself-start\b|\bpy-2\b/);
  });

  it("микрофон и крест — одна группа с равным зазором до края", async () => {
    const criteria = within(await open().findByRole("group", { name: "Готово, когда" }));
    const cross = criteria.getByRole("button", { name: "Пункт 1 не нужен" });
    const mic = criteria.getByRole("button", { name: "Голосовой ввод: Пункт 1" });
    const group = cross.parentElement!;
    expect(mic.parentElement).toBe(group);
    // Иконка 14px в кнопке 28px: 7px поля с каждой стороны. Зазор иконок — 7 + gap-1 + 7, до края — 7 + отступ строки.
    expect(group.className).toContain("gap-1");
    expect(rowOf(cross).className).toContain("pr-[11px]");
    expect([mic.className, cross.className].every((c) => c.includes("size-7"))).toBe(true);
  });

  it("то же у добавленного пункта и поля Дополнить", async () => {
    storeDraft(brief.id, setAddedCriterion(initialDraft(brief), 0, "Свой пункт"));
    const criteria = within(await open().findByRole("group", { name: "Готово, когда" }));
    const cross = criteria.getByRole("button", { name: "Убрать добавленный пункт 1" });
    const mic = criteria.getByRole("button", { name: "Голосовой ввод: Добавленный пункт 1" });
    expect(mic.parentElement).toBe(cross.parentElement);
    expect(cross.parentElement!.className).toContain("gap-1");
    expect(rowOf(cross).className).toContain("items-center");
    const tail = rowOf(criteria.getByRole("textbox", { name: "Дополнить" }));
    expect(tail.className).toContain("items-center");
    expect(within(tail).getByRole("button", { name: "Голосовой ввод: Дополнить" }).className).toContain("size-7");
  });
});

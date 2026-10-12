// @vitest-environment jsdom
// Выбор этапов в брифе: вложенный flow — одна свёрнутая строка с номером и галочкой на весь flow; раскрытая показывает его этапы
// с номерами через точку, а выбор не всех делает галочку полувыбранной.
import { cleanup, fireEvent } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { add, report, stage, stagedBrief } from "../core/stages-fixtures";
import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const BRIEF = [{ id: "nested", name: "Brief" }];
const brief = stagedBrief(
  [report("plugin", { state: "done" }), report("nested.questions", { state: "done" }), report("nested.task", { recommended: true }), report("nested.rename", { recommended: true }), report("spec", { recommended: true })],
  {
    stages: {
      list: [stage("plugin"), stage("nested.questions", { name: "Questions", nest: BRIEF }), stage("nested.task", { name: "Task", nest: BRIEF }), stage("nested.rename", { name: "Rename", nest: BRIEF }), stage("spec", { name: "Spec" })],
      minButtonWidth: 170,
    },
  },
);

const open = (b: DecisionBrief) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: b.id }, source: `::decision{id="${b.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief: b, answer: null }), answerBrief: () => ({ kind: "not_found" }), ...({ threadFiles } as object) } },
  );

type Slot = ReturnType<typeof open>;

/** Строки этапов и flow: номер и id. */
const rows = async (slot: Slot) => {
  await slot.findByRole("group", { name: "Этапы и бюджет" });
  return [...slot.container.querySelectorAll<HTMLElement>("[data-stage], [data-nest]")].map((r) => [r.querySelector("[data-stage-number]")?.textContent ?? "", r.dataset.stage ?? r.dataset.nest]);
};

const nestBox = (slot: Slot) => slot.getByRole("checkbox", { name: "Brief: в ближайший прогон" });

describe("вложенный flow в выборе этапов", () => {
  it("при открытии flow — одна свёрнутая строка с номером; у каждой строки номер", async () => {
    expect(await rows(open(brief))).toEqual([
      ["1", "plugin"],
      ["2", "nested"],
      ["3", "spec"],
    ]);
  });

  it("раскрытая строка flow показывает его этапы с номерами через точку", async () => {
    const slot = open(brief);
    await rows(slot);
    fireEvent.click(slot.getByRole("button", { name: "Brief", expanded: false }));
    expect(await rows(slot)).toEqual([
      ["1", "plugin"],
      ["2", "nested"],
      ["2.1", "nested.questions"],
      ["2.2", "nested.task"],
      ["2.3", "nested.rename"],
      ["3", "spec"],
    ]);
  });

  it("галочка flow снимает и ставит все его несделанные этапы", async () => {
    const slot = open(brief);
    await rows(slot);
    expect(nestBox(slot).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(nestBox(slot));
    expect(nestBox(slot).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(slot.getByRole("button", { name: "Brief", expanded: false }));
    expect(slot.getByRole("checkbox", { name: "Task: в ближайший прогон" }).getAttribute("aria-checked")).toBe("false");
    expect(slot.getByRole("checkbox", { name: "Rename: в ближайший прогон" }).getAttribute("aria-checked")).toBe("false");
  });

  it("выбраны не все этапы flow — галочка полувыбрана, щелчок ставит все", async () => {
    const slot = open(brief);
    await rows(slot);
    fireEvent.click(slot.getByRole("button", { name: "Brief", expanded: false }));
    fireEvent.click(slot.getByRole("checkbox", { name: "Task: в ближайший прогон" }));
    expect(nestBox(slot).getAttribute("aria-checked")).toBe("mixed");
    fireEvent.click(nestBox(slot));
    expect(slot.getByRole("checkbox", { name: "Task: в ближайший прогон" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("цена свёрнутой строки вложенного flow", () => {
  const priced = stagedBrief(
    [report("nested.task", { recommended: true, add: add(1, 2, 1, 5) }), report("nested.rename", { recommended: true, add: add(3, 6, 1) }), report("spec", { recommended: true, add: add(10, 20, 0, 30) })],
    { stages: { list: [stage("nested.task", { name: "Task", nest: BRIEF }), stage("nested.rename", { name: "Rename", nest: BRIEF }), stage("spec", { name: "Spec" })], minButtonWidth: 170 } },
  );
  const nestText = async (slot: Slot) => {
    await rows(slot);
    return slot.container.querySelector<HTMLElement>('[data-nest="nested"]')!.textContent ?? "";
  };

  it("сумма этапов flow в прогоне; минуты — только известные, без нуля за этап без минут", async () => {
    expect(await nestText(open(priced))).toMatch(/Brief.*5 мин.*\$4.*\$8/);
  });

  it("снятый этап из суммы уходит, снятый весь flow — чисел нет", async () => {
    const slot = open(priced);
    await rows(slot);
    fireEvent.click(slot.getByRole("button", { name: "Brief", expanded: false }));
    fireEvent.click(slot.getByRole("checkbox", { name: "Task: в ближайший прогон" }));
    expect(await nestText(slot)).toMatch(/\$3.*\$6/);
    expect(await nestText(slot)).not.toMatch(/мин/);
    fireEvent.click(nestBox(slot));
    fireEvent.click(nestBox(slot));
    expect(await nestText(slot)).not.toMatch(/\$/);
  });
});

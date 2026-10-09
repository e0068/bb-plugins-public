// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionAnswer, DecisionBrief, DispatchPlace, decisionsRpcContract, dispatchRpcContract } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_preselect",
  threadId: "thr_1",
  title: "Предвыбор компактации",
  createdAt: "2026-10-05T10:00:00.000Z",
  kind: "brief",
  setup: { criteria: ["Тесты зелёные"] },
  questions: [],
};

const { setup: _setup, ...bare } = brief;

const demo: DecisionBrief = {
  ...bare,
  id: "dec_demopreselect",
  launched: true,
  outcome: { stage: "demo", final: false, done: ["Сделано"], pending: [], results: [{ label: "x", target: "x.md" }] },
  stages: { list: [{ ...builtinStage("demo", []), name: "Демонстрация" }], minButtonWidth: 160 },
};

const open = (shown: DecisionBrief, place: { place: DispatchPlace; compact?: boolean }, sent: DecisionAnswer[]) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract>(
    app.messageDirectives[0]!,
    {
      attributes: { id: shown.id },
      source: `::decision{id="${shown.id}"}`,
      message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
      openWorkspaceFile: () => true,
    },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief: shown, answer: null }),
        answerBrief: ({ answer }) => {
          sent.push(answer);
          return { kind: "not_found" };
        },
        getDispatchPlace: () => place,
        listProjects: () => ({ kind: "found" as const, projects: [] }),
        ...({ threadFiles } as object),
      },
    },
  );

type Slot = ReturnType<typeof open>;

const placeCell = (slot: Slot) => slot.findByRole("button", { name: /^Исполнять/ });

const sendWith = async (slot: Slot, sent: DecisionAnswer[], button: RegExp) => {
  fireEvent.click(slot.getByRole("button", { name: button }));
  await waitFor(() => expect(sent).toHaveLength(1));
  return sent[0]!;
};

describe("предвыбор компактации по зоне контекста", () => {
  it("контекст в выбранной зоне — бриф открывается с компактацией, и она уходит в ответе", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(brief, { place: "here", compact: true }, sent);
    await waitFor(async () => expect((await placeCell(slot)).textContent).toContain("В этом треде · компактировать"));
    expect(await sendWith(slot, sent, /^Отправить/)).toMatchObject({ place: "here", compact: true });
  });

  it("предвыбор снимается «Как есть», и тогда компактации в ответе нет", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(brief, { place: "here", compact: true }, sent);
    await waitFor(async () => expect((await placeCell(slot)).textContent).toContain("компактировать"));
    fireEvent.click(await placeCell(slot));
    const context = within(await slot.findByRole("group", { name: "Контекст" }));
    expect(context.getByRole("button", { name: "Сперва компактировать тред" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(context.getByRole("button", { name: "Как есть" }));
    expect((await sendWith(slot, sent, /^Отправить/)).compact).toBeUndefined();
  });

  it("предвыбранная компактация не уезжает с ответом в новый тред", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(brief, { place: "here", compact: true }, sent);
    await waitFor(async () => expect((await placeCell(slot)).textContent).toContain("компактировать"));
    fireEvent.click(await placeCell(slot));
    fireEvent.click(within(slot.getByRole("group", { name: "Тред" })).getByRole("button", { name: "В новом треде" }));
    const answer = await sendWith(slot, sent, /^Отправить/);
    expect(answer.place).toBe("thread");
    expect(answer.compact).toBeUndefined();
  });

  it("Демонстрация тоже открывается с предвыбранной компактацией", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(demo, { place: "here", compact: true }, sent);
    await waitFor(async () => expect((await placeCell(slot)).textContent).toContain("компактировать"));
    expect(await sendWith(slot, sent, /^Продолжить/)).toMatchObject({ place: "here", compact: true });
  });
});

describe("«Завершить» финальной Демонстрации не компактирует тред по предвыбору", () => {
  const final: DecisionBrief = { ...demo, id: "dec_finalpreselect", outcome: { ...demo.outcome!, final: true } };
  const comment = (slot: Slot, text: string) => fireEvent.change(slot.getByRole("textbox", { name: "Комментарий к демонстрации" }), { target: { value: text } });

  it("без комментария ячейка не обещает компактацию, и «Завершить» уходит без неё", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(final, { place: "here", compact: true }, sent);
    await waitFor(async () => expect((await placeCell(slot)).textContent).toContain("В этом треде"));
    expect((await placeCell(slot)).textContent).not.toContain("компактировать");
    expect((await sendWith(slot, sent, /^Завершить/)).compact).toBeUndefined();
  });

  it("написан комментарий — предвыбор возвращается, и «Отправить» компактирует", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(final, { place: "here", compact: true }, sent);
    await placeCell(slot);
    comment(slot, "Поправь подпись");
    await waitFor(async () => expect((await placeCell(slot)).textContent).toContain("компактировать"));
    expect(await sendWith(slot, sent, /^Отправить/)).toMatchObject({ place: "here", compact: true });
  });

  it("компактацию, выбранную владельцем явно, «Завершить» уважает", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(final, { place: "here", compact: true }, sent);
    fireEvent.click(await placeCell(slot));
    const context = within(await slot.findByRole("group", { name: "Контекст" }));
    expect(context.getByRole("button", { name: "Как есть" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(context.getByRole("button", { name: "Сперва компактировать тред" }));
    expect(await sendWith(slot, sent, /^Завершить/)).toMatchObject({ place: "here", compact: true });
  });
});

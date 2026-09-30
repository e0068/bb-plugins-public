// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief, decisionsRpcContract, dispatchRpcContract, outcomeRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const LABEL = "Опубликовать витрину — откроет PR и напечатает ссылку";
const COMMAND = "node scripts/publish-public.mjs";

const demo: DecisionBrief = {
  id: "dec_label",
  threadId: "thr_1",
  title: "Демонстрация",
  createdAt: "2026-09-30T10:00:00.000Z",
  kind: "brief",
  launched: true,
  questions: [],
  outcome: { stage: "demo", final: false, next: "Ревью", done: ["Сделано"], pending: [], results: [{ label: "страница", target: "http://localhost:5173/" }, { label: LABEL, command: COMMAND }] },
  stages: { list: [{ ...builtinStage("demo", []), name: "Демонстрация" }], minButtonWidth: 160 },
};

type Rpc = typeof decisionsRpcContract & typeof dispatchRpcContract & typeof outcomeRpcContract;

const open = () =>
  renderSlot<PluginMessageDirectiveProps, Rpc>(
    app.messageDirectives[0]!,
    { attributes: { id: demo.id }, source: `::decision{id="${demo.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief: demo, answer: null }),
        answerBrief: (() => ({ kind: "not_found" })) as never,
        getDispatchPlace: () => ({ place: "here" }),
        listProjects: () => ({ kind: "found" as const, projects: [] }),
        runOutcomeCommand: (() => ({ kind: "sent", created: false })) as never,
      },
    },
  );

describe("команда в результатах Демонстрации подписана", () => {
  it("подпись видна текстом над самой командой", async () => {
    const slot = open();
    const row = within(await slot.findByRole("group", { name: LABEL }));
    const label = row.getByText(LABEL);
    const command = row.getByText(COMMAND);
    expect(label.compareDocumentPosition(command) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("строка команды — в том же списке и на той же подложке, что строка ссылки, справа три кнопки", async () => {
    const slot = open();
    await slot.findByRole("group", { name: LABEL });
    const [page, launch] = [...slot.container.querySelectorAll<HTMLElement>("[data-result-row]")];
    const backgrounds = (el: HTMLElement) => [...el.classList].filter((c) => c.startsWith("bg-"));
    expect(launch!.parentElement).toBe(page!.parentElement);
    expect(backgrounds(launch!)).toEqual(backgrounds(page!));
    expect(within(launch!).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Переносить строки", "Скопировать", "Выполнить в терминале"]);
  });

  it("ссылка рядом с командой по-прежнему открывает адрес в новой вкладке", async () => {
    const slot = open();
    const link = await slot.findByRole("link", { name: "страница" });
    expect(link.getAttribute("href")).toBe("http://localhost:5173/");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("подпись в строке одна, а команда под ней приглушённая и по кнопке переноса переносится вместо обрезки", async () => {
    const slot = open();
    const row = within(await slot.findByRole("group", { name: LABEL }));
    expect(row.getAllByText(LABEL)).toHaveLength(1);
    const command = row.getByText(COMMAND);
    expect(command.classList.contains("text-muted-foreground")).toBe(true);
    expect(command.classList.contains("truncate")).toBe(true);
    fireEvent.click(row.getByRole("button", { name: "Переносить строки" }));
    expect(row.getByText(COMMAND).classList.contains("whitespace-pre-wrap")).toBe(true);
  });
});
